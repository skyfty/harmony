(let* (
  (image (car (gimp-file-load RUN-NONINTERACTIVE
    "C:/Users/Administrator/.codex/visualizations/2026/11/15/01a1dea7-f8b7-7983-a5f4-a6cc6fe029c1/rc-hall-textures/source-roof-tiles.png")))
)
  (gimp-file-save RUN-NONINTERACTIVE image
    "C:/Users/Administrator/.codex/visualizations/2026/11/15/01a1dea7-f8b7-7983-a5f4-a6cc6fe029c1/rc-hall-textures/gimp-save-test.png")
  (gimp-image-delete image)
)
