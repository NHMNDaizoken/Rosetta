# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
"""Validate the implemented OpenAPI and in-memory HTTP observations; never log payloads."""
import copy
import hashlib
import json
import re
import sys
import urllib.request
from urllib.parse import urlsplit
from datetime import datetime
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parent.parent
CONTRACT = ROOT / 'docs/contracts/foundation-api.openapi.json'
URI = CONTRACT.as_uri()
META = 'https://spec.openapis.org/oas/3.1/schema/2022-10-07'
META_SHA = 'da01ba28852cac0de53893797cb8d1942bc3b05084f526dcc216717dec314ed0'
METHODS = {'get', 'head', 'post', 'put', 'patch', 'delete', 'options', 'trace'}
# Independently reviewed handler inventory, not extracted from the specification.
# When handlers change, review this inventory and add an observed positive case.
EXPECTED = {
    '/health': {'get', 'head'}, '/ready': {'get'}, '/v1/identity': {'get'},
    '/v1/applications': {'post'}, '/v1/applications/{appId}': {'get'},
    '/v1/applications/{appId}/approve': {'post'}, '/v1/applications/{appId}/state': {'post'},
    '/v1/approvals': {'post'}, '/v1/approvals/{approvalId}': {'get'},
    '/v1/approvals/{approvalId}/revoke': {'post'},
    '/v2/resource-shares': {'post'}, '/v2/resource-shares/{shareId}': {'delete'},
    '/v1/workflows/definitions': {'get'}, '/v1/workflows/executions': {'post'},
    '/v1/workflows/executions/{executionId}': {'get', 'delete'},
    '/v1/workflows/executions/{executionId}/complete': {'post'},
}
for version in ('v1', 'v2'):
    EXPECTED.update({f'/{version}/data/{{collection}}': {'get', 'post'},
                     f'/{version}/data/{{collection}}/{{id}}': {'get', 'patch', 'delete'},
                     f'/{version}/objects': {'post'},
                     f'/{version}/objects/{{id}}': {'get', 'put', 'delete'}})
OIDC = '/identity/realms/rosetta'
EXPECTED[OIDC + '/.well-known/openid-configuration'] = {'get'}
for suffix, methods in {'auth': {'get'}, 'token': {'post'}, 'certs': {'get'},
                        'userinfo': {'get', 'post'}, 'logout': {'get', 'post'}}.items():
    EXPECTED[OIDC + '/protocol/openid-connect/' + suffix] = methods


class ContractError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise ContractError(message)


def resolve(spec, value):
    if isinstance(value, dict) and '$ref' in value:
        ref = value['$ref']
        require(ref.startswith('#/'), 'Foundation references must be local fragments')
        target = spec
        try:
            for part in ref[2:].split('/'):
                target = target[part.replace('~1', '/').replace('~0', '~')]
        except (KeyError, TypeError):
            raise ContractError('Unresolved local reference') from None
        return target
    return value


FORMATS = FormatChecker()


@FORMATS.checks('date-time', raises=(ValueError, TypeError))
def date_time(value):
    if not isinstance(value, str):
        return True
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value):
        return False
    return datetime.fromisoformat(value.replace('Z', '+00:00')).tzinfo is not None


@FORMATS.checks('uri', raises=(ValueError, TypeError))
def absolute_uri(value):
    if not isinstance(value, str):
        return True
    parsed = urlsplit(value)
    return bool(parsed.scheme) and not re.search(r'[\s\x00-\x1f]', value) and (bool(parsed.netloc) if parsed.scheme in ('http', 'https') else bool(parsed.path))


def check_value(spec, schema, value, label):
    # Bind local component refs to the whole contract, not the nested schema.
    document = {**spec, '$defs': {'Observed': schema}}
    registry = Registry().with_resource(URI, Resource.from_contents(document, default_specification=DRAFT202012))
    validator = Draft202012Validator({'$ref': URI + '#/$defs/Observed'}, registry=registry, format_checker=FORMATS)
    error = next(validator.iter_errors(value), None)
    # jsonschema's normal messages can contain tokens/payloads. Never emit them.
    require(error is None, label + ': schema mismatch' + (f' ({error.validator})' if error else ''))


def validate_document(spec, official=True):
    require(spec.get('openapi') == '3.1.1', 'Expected OpenAPI 3.1.1')
    require(spec.get('x-rosetta-status') == 'implemented', 'Foundation must describe implemented routes')
    actual = {p: set(v) & METHODS for p, v in spec['paths'].items()}
    require(actual == EXPECTED, 'Route/method inventory differs from reviewed handlers')
    ids = set()

    def walk(value):
        if isinstance(value, dict):
            if '$ref' in value:
                resolve(spec, value)
            for key, child in value.items():
                if key == 'schema' and isinstance(child, (dict, bool)):
                    Draft202012Validator.check_schema(child)
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(spec)
    for schema in spec['components']['schemas'].values():
        Draft202012Validator.check_schema(schema)
    for path, methods in spec['paths'].items():
        for method, operation in methods.items():
            oid = operation['operationId']
            require(oid not in ids, 'Duplicate operationId')
            ids.add(oid)
            require((ROOT / operation['x-rosetta-source']).is_file(), oid + ': source missing')
            require(operation['x-rosetta-test-suite'] in ('core', 'applications'), oid + ': coverage suite missing')
            parameters = [resolve(spec, p) for p in operation.get('parameters', [])]
            require(len({(p['in'], p['name']) for p in parameters}) == len(parameters), oid + ': duplicate parameter')
            require({p['name'] for p in parameters if p['in'] == 'path'} == set(re.findall(r'{([^}]+)}', path)), oid + ': path parameters differ')
            require(all(p.get('required') for p in parameters if p['in'] == 'path'), oid + ': path parameter optional')
            if path.startswith(('/v1/', '/v2/')):
                require(operation['security'] == [{'coreBearer': []}], oid + ': bearer protection missing')
                admin = path.startswith(('/v1/applications', '/v1/approvals'))
                roles = ['core-reader'] + (['core-writer'] if method != 'get' and not admin else [])
                require(operation['x-rosetta-core-roles'] == roles, oid + ': role contract differs')
            if path.startswith(('/v1/data/', '/v1/objects')):
                require(operation.get('deprecated') is True and operation['x-rosetta-authority'] == 'legacy-tenant', oid + ': legacy boundary missing')
            if path.startswith('/v2/'):
                require(operation['x-rosetta-authority'] == 'app-resource', oid + ': app boundary missing')
    if official:
        with urllib.request.urlopen(META, timeout=20) as response:
            raw = response.read()
        require(hashlib.sha256(raw).hexdigest() == META_SHA, 'Official metaschema digest changed; review before updating pin')
        error = next(Draft202012Validator(json.loads(raw)).iter_errors(spec), None)
        require(error is None, 'Official OpenAPI structural validation failed')
    return len(ids)


def validate_observations(spec, observations, suite=None):
    covered = set()
    for item in observations:
        path, method = item['path'], item['method'].lower()
        require(path in spec['paths'], 'Observed route missing from Foundation')
        operation = spec['paths'][path].get(method)
        code = str(item['status'])
        label = operation['operationId'] if operation else 'unsupported method'
        if operation:
            require(code in operation['responses'], label + ': undocumented status ' + code)
            response = resolve(spec, operation['responses'][code])
        else:
            require(item['status'] in (400, 401, 403, 404, 405, 413, 429, 502, 503, 504), 'Undocumented method succeeded')
            name = {400:'BadRequest',401:'Unauthorized',403:'Forbidden',404:'NotFound',405:'MethodNotAllowed',413:'TooLarge',429:'RateLimited',502:'BadGateway',503:'Unavailable',504:'GatewayTimeout'}[item['status']]
            response = spec['components']['responses'][name]
        headers = item['responseHeaders']
        for name, value in response.get('headers', {}).items():
            definition = resolve(spec, value)
            require(not definition.get('required') or name.lower() in headers, label + ': required response header missing')
            if name.lower() in headers:
                check_value(spec, definition['schema'], headers[name.lower()], label + ' response header')
        if method == 'head' or item['status'] == 204:
            require(item['responseBytes'] == 0, label + ': body forbidden')
        elif 'content' in response:
            media = headers.get('content-type', '').split(';')[0].strip()
            require(media in response['content'], label + ': undocumented response content type')
            if media == 'application/json':
                require(not item.get('responseInvalidJson'), label + ': invalid response JSON')
                check_value(spec, response['content'][media]['schema'], item.get('responseBody'), label + ' response')
            elif media == 'application/octet-stream':
                require(item['responseBytes'] > 0, label + ': empty object download')
                require(int(headers['content-length']) == item['responseBytes'], label + ': binary length mismatch')
            else:
                require(item['responseBytes'] > 0, label + ': empty text representation')
        if not operation or item['status'] >= 400:
            continue  # Malformed/unauthorized negative requests need not satisfy a success request schema.
        covered.add(operation['operationId'])
        security = operation.get('security', [])
        require(not security or {} in security or item['authorized'], label + ': protected request succeeded without credentials')
        parameters = [resolve(spec, p) for p in operation.get('parameters', [])]
        known_query = {p['name'] for p in parameters if p['in'] == 'query'}
        if operation['x-rosetta-query-policy'] == 'closed':
            require(set(item['query']) <= known_query, label + ': unknown query succeeded')
        for param in parameters:
            where = {'path': item['pathParams'], 'query': item['query'], 'header': item['requestHeaders']}[param['in']]
            key = param['name'].lower() if param['in'] == 'header' else param['name']
            require(not param.get('required') or key in where, label + ': required request parameter missing')
            if key in where:
                value = where[key]
                schema = resolve(spec, param['schema'])
                if schema.get('type') == 'integer':
                    try:
                        value = int(value)
                    except (ValueError, TypeError):
                        raise ContractError(label + ': noninteger query') from None
                check_value(spec, param['schema'], value, label + ' request parameter')
        if 'requestBody' in operation:
            require(item['requestBytes'] > 0, label + ': missing request body')
            require(item['requestBytes'] <= operation.get('x-max-body-bytes', 10485760), label + ': accepted oversized body')
            require(item['requestBytes'] >= operation.get('x-min-body-bytes', 0), label + ': accepted undersized body')
            media = item['requestHeaders'].get('content-type', '').split(';')[0].strip()
            require(media in operation['requestBody']['content'], label + ': accepted undocumented request media type')
            if media != 'application/octet-stream':
                require(not item.get('requestInvalidJson'), label + ': accepted invalid request JSON')
                check_value(spec, operation['requestBody']['content'][media]['schema'], item.get('requestBody'), label + ' request')
    if suite:
        required = {o['operationId'] for m in spec['paths'].values() for o in m.values() if o['x-rosetta-test-suite'] == suite}
        require(required <= covered, 'Missing positive operation coverage: ' + ', '.join(sorted(required - covered)))
    return len(observations), len(covered)


def self_test(spec):
    good = {'path':'/health','method':'GET','status':200,'authorized':False,'query':{},'pathParams':{},'requestHeaders':{},'requestBytes':0,
            'responseHeaders':{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff, nosniff'},
            'responseBody':{'service':'rosetta-core','status':'ok'},'responseBytes':44}
    validate_observations(spec, [good])
    mutations = [lambda d:d.update(status=201), lambda d:d['responseBody'].pop('status'),
                 lambda d:d['responseBody'].update(status=123), lambda d:d['responseBody'].update(extra=True),
                 lambda d:d['responseHeaders'].update({'content-type':'text/plain'}),
                 lambda d:d['responseHeaders'].pop('cache-control')]
    for mutate in mutations:
        bad = copy.deepcopy(good)
        mutate(bad)
        try:
            validate_observations(spec, [bad])
        except ContractError:
            continue
        raise ContractError('Conformance validator accepted a deliberate regression')
    for change in ('duplicate', 'reference', 'route', 'security', 'legacy'):
        bad = copy.deepcopy(spec)
        if change == 'duplicate':
            bad['paths']['/health']['get']['operationId'] = bad['paths']['/ready']['get']['operationId']
        elif change == 'reference':
            bad['components']['schemas']['Record']['properties']['data'] = {'$ref': '#/components/schemas/Absent'}
        elif change == 'route':
            del bad['paths']['/health']['head']
        elif change == 'security':
            bad['paths']['/v2/objects']['post']['security'] = []
        else:
            bad['paths']['/v1/objects']['post']['deprecated'] = False
        try:
            validate_document(bad, official=False)
        except ContractError:
            continue
        raise ContractError('Static validator accepted a deliberate ' + change + ' regression')
    protected = copy.deepcopy(good)
    protected.update(path='/v1/identity', responseBody={'subject':'fixture','tenantId':'tenant-a','roles':['core-reader']})
    try:
        validate_observations(spec, [protected])
    except ContractError:
        pass
    else:
        raise ContractError('Unauthenticated success was accepted')
    protected['authorized'] = True
    validate_observations(spec, [protected])
    print('Validator controls passed: wire/schema errors, auth bypass, missing routes/refs, duplicate IDs and legacy regressions rejected')


def capability_contract(cases=None):
    """Validate local extension schemas and real Trust bodies without logging them."""
    contract = ROOT / 'docs/contracts/capability-api-v1.openapi.json'
    spec = json.loads(contract.read_text(encoding='utf-8'))
    registry = Registry().with_resources(
        (p.as_uri(), Resource.from_contents(json.loads(p.read_text(encoding='utf-8')), default_specification=DRAFT202012))
        for p in contract.parent.glob('*.json'))
    for schema in spec['components']['schemas'].values():
        Draft202012Validator.check_schema(schema)
    supplied = cases if cases is not None else list(json.loads((contract.parent / 'examples/api-examples.json').read_text(encoding='utf-8')).values())
    require(bool(supplied), 'Capability contract observations are empty')
    for item in supplied:
        validator = Draft202012Validator({'$ref': contract.as_uri() + '#/components/schemas/' + item['schema']}, registry=registry, format_checker=FORMATS)
        error = next(validator.iter_errors(item['value']), None)
        require(error is None, 'Capability ' + item['schema'] + ': schema mismatch')
    return len(supplied)


def main():
    spec = json.loads(CONTRACT.read_text(encoding='utf-8'))
    if '--capability-runtime' in sys.argv:
        batch = json.load(sys.stdin)
        count = capability_contract(batch['observations'])
        print(f'Capability contract: {count} real Trust request/response schema cases passed')
    elif '--runtime' in sys.argv:
        batch = json.load(sys.stdin)
        count, covered = validate_observations(spec, batch['observations'], batch['suite'])
        print(f'Foundation conformance: {count} responses, {covered} successful operations ({batch["suite"]})')
    elif '--self-test' in sys.argv:
        self_test(spec)
    else:
        count = validate_document(spec)
        capability_contract()
        print(f'OpenAPI 3.1 structure, schemas, local refs, IDs, authorization and {count} reviewed operations passed')


if __name__ == '__main__':
    try:
        main()
    except ContractError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
