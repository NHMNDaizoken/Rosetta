# Third-party inventory

This foundation has no npm dependencies and copies no third-party application
source. Entries below describe development/runtime components; they do not
approve a project license. Project distribution remains blocked pending the
decisions in [docs/LICENSING.md](docs/LICENSING.md).

| Component | Version | Upstream and license | Use and obligations |
| --- | --- | --- | --- |
| Node.js | 24.x; target 24.21.0 in `.node-version` | [Upstream](https://nodejs.org/), [license and bundled notices](https://github.com/nodejs/node/blob/v24.21.0/LICENSE); Node.js code is MIT, bundled components have additional terms | Runtime and built-in HTTP/test tooling. Native runtime is installed separately. Preserve upstream license and bundled notices when redistributing it; review the complete runtime inventory before release. |
| Official Node Docker image | `node:24.21.0-bookworm-slim`, index digest `sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20` | [Image source at revision 93a7baf](https://github.com/nodejs/docker-node/tree/93a7bafc324a85ac1ee461604cff87cffacb6d7a/24/bookworm-slim), [image source license](https://github.com/nodejs/docker-node/blob/93a7bafc324a85ac1ee461604cff87cffacb6d7a/LICENSE) MIT; Debian/runtime packages have individual licenses | Local build base. Upstream notices are retained in the base layers; do not strip them. Review `/usr/share/doc/*/copyright`, the Node license and all bundled components before redistributing an image. No registry publishing is configured. |
| actions/checkout | v6.1.0, commit `d23441a48e516b6c34aea4fa41551a30e30af803` | [Source and MIT license](https://github.com/actions/checkout/tree/d23441a48e516b6c34aea4fa41551a30e30af803) | GitHub-hosted CI tool; referenced, not vendored. Preserve notices if later copied. Checkout does not persist repository credentials. |
| actions/setup-node | v6.5.0, commit `249970729cb0ef3589644e2896645e5dc5ba9c38` | [Source and MIT license](https://github.com/actions/setup-node/tree/249970729cb0ef3589644e2896645e5dc5ba9c38) | GitHub-hosted CI runtime installer; referenced, not vendored. Preserve notices if later copied. |

There is no npm install step or lockfile because the package has no dependency
graph. New packages, service images or borrowed assets require inventory updates
and license review before use. This inventory is not a vulnerability or license
audit of the host operating system.
