# Third-party inventory

Original Rosetta code is Apache-2.0; upstream components retain their own terms.
No third-party application source is copied. Entries describe separately fetched
runtime/development components and their obligations. See
[docs/LICENSING.md](docs/LICENSING.md) for the approved project policy.

| Component | Version | Upstream and license | Use and obligations |
| --- | --- | --- | --- |
| Node.js | 24.x; target 24.21.0 in `.node-version` | [Upstream](https://nodejs.org/), [license and bundled notices](https://github.com/nodejs/node/blob/v24.21.0/LICENSE); Node.js code is MIT, bundled components have additional terms | Runtime and built-in HTTP/test tooling. Native runtime is installed separately. Preserve upstream license and bundled notices when redistributing it; review the complete runtime inventory before release. |
| Official Node Docker image | `node:24.21.0-bookworm-slim`, index digest `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20` | [Image source at revision 93a7baf](https://github.com/nodejs/docker-node/tree/93a7bafc324a85ac1ee461604cff87cffacb6d7a/24/bookworm-slim), [image source license](https://github.com/nodejs/docker-node/blob/93a7bafc324a85ac1ee461604cff87cffacb6d7a/LICENSE) MIT; Debian/runtime packages have individual licenses | Local build base. Upstream notices are retained in the base layers; do not strip them. Review `/usr/share/doc/*/copyright`, the Node license and all bundled components before redistributing an image. No registry publishing is configured. |
| actions/checkout | v6.1.0, commit `d23441a48e516b6c34aea4fa41551a30e30af803` | [Source and MIT license](https://github.com/actions/checkout/tree/d23441a48e516b6c34aea4fa41551a30e30af803) | GitHub-hosted CI tool; referenced, not vendored. Preserve notices if later copied. Checkout does not persist repository credentials. |
| actions/setup-node | v6.5.0, commit `249970729cb0ef3589644e2896645e5dc5ba9c38` | [Source and MIT license](https://github.com/actions/setup-node/tree/249970729cb0ef3589644e2896645e5dc5ba9c38) | GitHub-hosted CI runtime installer; referenced, not vendored. Preserve notices if later copied. |
| GitHub CLI | 2.103.0 | [Source and MIT license](https://github.com/cli/cli/tree/v2.103.0) | Local publication tooling only, downloaded to temporary storage and verified against the official release asset SHA-256. Not included in Rosetta source or images. |

There is no npm install step or lockfile because the package has no dependency
graph. New packages, service images or borrowed assets require inventory updates
and license review before use. This inventory is not a vulnerability or license
audit of the host operating system.

## Layer 1 infrastructure review

These are unmodified upstream OSS images fetched by the operator's Docker engine.
The source repository distributes configuration/adapters, not copies of these
images or upstream source. No derivative upstream source has been produced.
Bundled OS/library notices stay in the original image layers. A future binary
image bundle or registry release needs a complete package inventory and any
required corresponding-source offers; process separation alone is not an exemption.

| Component/image | Exact pin | Verified upstream terms and edition | Integration/obligations |
| --- | --- | --- | --- |
| Keycloak OSS | `26.8.1`, `sha256:79c623a22abacf3fe6c00a5fb30f5b7843d717b234033b80995891c06116d244` | [Apache-2.0](https://github.com/keycloak/keycloak/blob/26.8.1/LICENSE.txt), [official container](https://www.keycloak.org/server/containers) | Hosted OIDC/SSO server; keep upstream licenses/notice content and Java/base OS notices. No modifications or vendor source copying. |
| Nginx OSS official image | `stable-bookworm`, `sha256:552e7481ca93ffccd046aa658dbbed22caefbc09c66fa7cd247cbb90b8a5c609` | [BSD-2-Clause](https://nginx.org/LICENSE), [official image source](https://github.com/nginx/docker-nginx) | Hosted reverse proxy/auth-request gateway; BSD notices must accompany binary redistribution. Debian and bundled library terms also apply. No Nginx Plus dependency. |
| PostgreSQL official image | `17-bookworm`, `sha256:858bb5e98eed02eb8cafbcdc007f9a65d1b613972028944a8ec2133ccaf80d27` | [PostgreSQL](https://www.postgresql.org/about/licence/), [official image source](https://github.com/docker-library/postgres) | Hosted persistence with separate database roles; preserve PostgreSQL copyright/permission and base-package notices. No source changes. |
| PostgREST OSS | `v16.5`, `sha256:1347d7552b88f17832912c06afbf7c43209af6eeeb60834b04aae12c9bd9d5cc` | [MIT](https://github.com/PostgREST/postgrest/blob/v16.5/LICENSE), [image build source](https://github.com/PostgREST/postgrest/tree/v16.5) | Hosted data API. Preserve copyright/permission notice for any redistribution; SQL authorization uses upstream RLS support. |
| SeaweedFS OSS | `4.48`, `sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d` | [Apache-2.0](https://github.com/seaweedfs/seaweedfs/blob/4.48/LICENSE), [image source](https://github.com/seaweedfs/seaweedfs/tree/4.48/docker) | Hosted filer/object storage; not the Enterprise image. Preserve Apache notices and base-package obligations if redistributed. |
| Flowable REST OSS | `8.0.0`, `sha256:708dfa32f27b93180bb6e7a30684d881d995fe257f5b8413e14b20a55c25672d` | [Apache-2.0](https://github.com/flowable/flowable-engine/blob/flowable-8.0.0/LICENSE), [image/base source](https://github.com/flowable/flowable-engine/tree/flowable-8.0.0/docker) | Hosted BPMN engine via REST, without a Rosetta GUI. Java runtime, fonts and Alpine packages have separate terms; retain their notices and review corresponding-source requirements before binary distribution. |

The review above establishes source provenance, selected edition and the current
configuration-only hosting model. It is not a claim that every transitive binary
package has passed a redistribution or vulnerability audit. Rosetta does not
strip upstream license material, republish images or change their licensing.

## Contract-validation tooling

The Foundation OpenAPI milestone reuses these validators in development/CI via
`requirements-contracts.txt`; they are not copied into the Core image or added as
npm/runtime dependencies. Python must be 3.10+. CI installs exact package pins.
On Python <3.13, referencing also uses typing-extensions 4.15.0
([PSF-2.0 and bundled notices](https://github.com/python/typing_extensions/blob/4.15.0/LICENSE));
its installed distribution metadata was verified as PSF-2.0. Preserve those notices
if redistributed. No packages were installed locally for this milestone.

The official [OpenAPI 3.1 metaschema](https://spec.openapis.org/oas/3.1/schema/2022-10-07)
is fetched into memory, not vendored; SHA-256
`da01ba28852cac0de53893797cb8d1942bc3b05084f526dcc216717dec314ed0`
pins its reviewed bytes. CI requires HTTPS access and fails on a digest change.

The Capability v1 documentation was checked using the already installed Python 3.14.3 environment ([PSF terms and bundled notices](https://docs.python.org/3/license.html)), jsonschema 4.23.0 ([MIT](https://github.com/python-jsonschema/jsonschema/blob/v4.23.0/COPYING)), [referencing 0.37.0](https://pypi.org/project/referencing/0.37.0/), [attrs 25.4.0](https://pypi.org/project/attrs/25.4.0/), [rpds-py 0.30.0](https://pypi.org/project/rpds-py/0.30.0/) and [jsonschema-specifications 2025.9.1](https://pypi.org/project/jsonschema-specifications/2025.9.1/) (each reports MIT in its installed distribution metadata). These are host validation tools, not new Rosetta runtime/package dependencies, vendored sources or shipped binaries. No packages were installed for that earlier documentation task. Preserve each upstream distribution license if these tools are later bundled. The official OpenAPI validation schema was fetched into memory from its standards publisher, not copied into Rosetta.
