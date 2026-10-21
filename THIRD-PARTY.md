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
