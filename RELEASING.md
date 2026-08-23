# Releasing

Both packages publish automatically from a **GitHub Release** via OIDC
[Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — there are **no tokens or
API keys stored as secrets**. The [`release.yml`](.github/workflows/release.yml) workflow is
idempotent: if a version is already on the registry it skips that package, so tagging a
historical version never fails the build.

## Packages

| Package | Registry | Manifest (bump version here) |
|---------|----------|------------------------------|
| `openapi-remote-codegen` | npm | [`packages/codegen/package.json`](packages/codegen/package.json) |
| `OpenApiRemoteCodegen.Attributes` | NuGet | [`attributes/dotnet/OpenApi.Remote.Attributes.csproj`](attributes/dotnet/OpenApi.Remote.Attributes.csproj) (`<Version>`) |

## Cutting a release

1. Bump the version in whichever manifest(s) changed.
2. Open a PR → CI ([`ci.yml`](.github/workflows/ci.yml)) runs build + tests → merge to `main`.
3. On GitHub → **Releases** → **Draft a new release**.
   - Create a tag `vX.Y.Z` matching the new version, targeting `main`.
   - Write release notes → **Publish release**.
4. `release.yml` builds, tests, and publishes each package whose version is new.
5. Downstream consumers bump their dependency — no more `pnpm patch`.

## One-time trust setup (do this once, on the registry websites)

Trusted Publishing requires linking each registry package to this repo + workflow. This
cannot be automated and only needs to be done once.

### npm
1. https://www.npmjs.com/package/openapi-remote-codegen → **Settings** → **Trusted Publisher**.
2. Provider: **GitHub Actions**.
   - Organization/user: `ryceg`
   - Repository: `openapi-remote-codegen`
   - Workflow filename: `release.yml`
3. Save.

### NuGet
1. https://www.nuget.org/account/trustedpublishing → **Add**.
2. Package owner: your nuget.org account. Package: `OpenApiRemoteCodegen.Attributes`.
   - Repository owner: `ryceg`
   - Repository: `openapi-remote-codegen`
   - Workflow file: `release.yml`
3. Save.
4. In the GitHub repo → **Settings** → **Secrets and variables** → **Actions** → **Variables**,
   add a repository variable `NUGET_USER` set to your nuget.org username (used by the
   `NuGet/login` OIDC action; it is not a secret).
