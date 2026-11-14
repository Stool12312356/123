# Abrams GLB source

These are the geometry generators from the tank model supplied by the user in Google Drive:

`https://drive.google.com/drive/folders/1bA3xXqrpS9y7wXfsvyISC54pNFsCzBX1`

The original folder also contains its standalone HTML renderer. The site runtime does not execute that renderer or these generators. It loads the generated `../abrams-user.glb` through `js/glb-loader.js`.

Rebuild the deterministic GLB from the repository root:

```sh
node tools/build-abrams-glb.js
```

The build uses only Node.js built-ins and writes a glTF 2.0 scene with reusable meshes, vertex colours/material metadata, and named hull, turret, gun, running-gear, and track-link nodes.
