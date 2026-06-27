# Host & Agent launcher icon source

Drop a square **1024×1024 PNG** named `icon.png` in this folder, then from
`mobile/host_agent` run:

```
dart run flutter_launcher_icons
```

That generates the Android mipmaps and the iOS AppIcon set (config in
`../flutter_launcher_icons.yaml`).

Use a **distinct** mark from the Tenant app so the two installs are visually
different. `design/assets/roomadda-logo.jpg` is a wide wordmark (≈3:1), shared by
both apps — not suitable as a square icon.
