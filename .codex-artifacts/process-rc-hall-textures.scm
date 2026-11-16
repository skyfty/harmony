(define texture-root
  "C:/Users/Administrator/.codex/visualizations/2026/11/15/01a1dea7-f8b7-7983-a5f4-a6cc6fe029c1/rc-hall-textures/")

(define (texture-path name)
  (string-append texture-root name))

(define (selected-drawable image)
  (vector-ref (car (gimp-image-get-selected-drawables image)) 0))

(define (save-image image name)
  (gimp-file-save RUN-NONINTERACTIVE image (texture-path name)))

(define (make-albedo-and-maps source-prefix output-prefix make-seamless)
  (let* (
    (image (car (gimp-file-load RUN-NONINTERACTIVE
      (texture-path (string-append source-prefix ".png")))))
    (drawable (selected-drawable image))
  )
    (if make-seamless
      (gimp-drawable-merge-new-filter drawable "gegl:tile-seamless" 0
        LAYER-MODE-REPLACE 1.0))
    (save-image image (string-append output-prefix "-albedo.png"))
    (gimp-image-delete image)
  )

  (let* (
    (image (car (gimp-file-load RUN-NONINTERACTIVE
      (texture-path (string-append source-prefix ".png")))))
    (drawable (selected-drawable image))
  )
    (if make-seamless
      (gimp-drawable-merge-new-filter drawable "gegl:tile-seamless" 0
        LAYER-MODE-REPLACE 1.0))
    (gimp-drawable-merge-new-filter drawable "gimp:desaturate" 0
      LAYER-MODE-REPLACE 1.0 "mode" DESATURATE-LIGHTNESS)
    (gimp-drawable-merge-new-filter drawable "gimp:brightness-contrast" 0
      LAYER-MODE-REPLACE 1.0 "brightness" 0.18 "contrast" 0.12)
    (save-image image (string-append output-prefix "-roughness.png"))
    (gimp-image-delete image)
  )

  (let* (
    (image (car (gimp-file-load RUN-NONINTERACTIVE
      (texture-path (string-append source-prefix ".png")))))
    (drawable (selected-drawable image))
  )
    (if make-seamless
      (gimp-drawable-merge-new-filter drawable "gegl:tile-seamless" 0
        LAYER-MODE-REPLACE 1.0))
    (gimp-drawable-merge-new-filter drawable "gimp:desaturate" 0
      LAYER-MODE-REPLACE 1.0 "mode" DESATURATE-LIGHTNESS)
    (gimp-drawable-merge-new-filter drawable "gegl:normal-map" 0
      LAYER-MODE-REPLACE 1.0
      "scale" 4.0 "flip-x" FALSE "flip-y" TRUE
      "full-z" FALSE "tileable" TRUE)
    (save-image image (string-append output-prefix "-normal.png"))
    (gimp-image-delete image)
  )
)

(define (fill-rect image drawable x y width height color)
  (gimp-image-select-rectangle image CHANNEL-OP-REPLACE x y width height)
  (gimp-context-set-foreground color)
  (gimp-drawable-edit-fill drawable FILL-FOREGROUND)
  (gimp-selection-none image)
)

(define (fill-ellipse image drawable x y width height color)
  (gimp-image-select-ellipse image CHANNEL-OP-REPLACE x y width height)
  (gimp-context-set-foreground color)
  (gimp-drawable-edit-fill drawable FILL-FOREGROUND)
  (gimp-selection-none image)
)

(make-albedo-and-maps "source-roof-tiles" "rc-roof-tiles" TRUE)
(make-albedo-and-maps "source-plaster" "rc-plaster" TRUE)
(make-albedo-and-maps "source-red-lacquer" "rc-red-lacquer" TRUE)
(make-albedo-and-maps "source-painted-frieze" "rc-painted-frieze" FALSE)

(let* (
  (image (car (gimp-image-new 2048 320 RGB)))
  (background (car (gimp-layer-new image "Sign background" 2048 320
    RGB-IMAGE 100 LAYER-MODE-NORMAL)))
  (text-layer (car (gimp-text-layer-new image "游客服务中心" 2451 218 PIXELS)))
)
  (gimp-image-insert-layer image background 0 -1)
  (gimp-context-set-foreground '(16 41 37))
  (gimp-drawable-edit-fill background FILL-FOREGROUND)
  (fill-rect image background 0 0 2048 14 '(190 146 66))
  (fill-rect image background 0 306 2048 14 '(190 146 66))
  (fill-rect image background 0 0 14 320 '(190 146 66))
  (fill-rect image background 2034 0 14 320 '(190 146 66))
  (fill-rect image background 40 40 1968 6 '(92 69 38))
  (fill-rect image background 40 274 1968 6 '(92 69 38))
  (gimp-image-insert-layer image text-layer 0 -1)
  (gimp-text-layer-set-color text-layer '(221 177 84))
  (gimp-layer-set-offsets text-layer 178 20)
  (gimp-image-flatten image)
  (save-image image "rc-sign-visitor-center.png")
  (gimp-image-delete image)
)

(let* (
  (image (car (gimp-image-new 512 768 RGB)))
  (background (car (gimp-layer-new image "Door background" 512 768
    RGB-IMAGE 100 LAYER-MODE-NORMAL)))
)
  (gimp-image-insert-layer image background 0 -1)
  (gimp-context-set-foreground '(48 28 19))
  (gimp-drawable-edit-fill background FILL-FOREGROUND)
  (fill-rect image background 0 0 512 18 '(102 58 30))
  (fill-rect image background 0 750 512 18 '(102 58 30))
  (fill-rect image background 0 0 18 768 '(102 58 30))
  (fill-rect image background 494 0 18 768 '(102 58 30))
  (fill-rect image background 249 0 14 768 '(92 50 25))
  (fill-rect image background 36 36 210 280 '(66 37 22))
  (fill-rect image background 266 36 210 280 '(66 37 22))
  (fill-rect image background 36 356 210 330 '(66 37 22))
  (fill-rect image background 266 356 210 330 '(66 37 22))
  (fill-rect image background 54 54 174 244 '(31 20 14))
  (fill-rect image background 284 54 174 244 '(31 20 14))
  (fill-rect image background 54 374 174 294 '(31 20 14))
  (fill-rect image background 284 374 174 294 '(31 20 14))
  (fill-ellipse image background 222 365 24 24 '(194 151 69))
  (fill-ellipse image background 266 365 24 24 '(194 151 69))
  (save-image image "rc-door-lattice.png")
  (gimp-image-delete image)
)

(let* (
  (image (car (gimp-image-new 512 512 RGB)))
  (background (car (gimp-layer-new image "Window background" 512 512
    RGB-IMAGE 100 LAYER-MODE-NORMAL)))
)
  (gimp-image-insert-layer image background 0 -1)
  (gimp-context-set-foreground '(128 82 43))
  (gimp-drawable-edit-fill background FILL-FOREGROUND)
  (fill-rect image background 20 20 472 472 '(23 19 14))
  (fill-rect image background 108 20 18 472 '(100 61 34))
  (fill-rect image background 232 20 18 472 '(100 61 34))
  (fill-rect image background 356 20 18 472 '(100 61 34))
  (fill-rect image background 20 108 472 18 '(100 61 34))
  (fill-rect image background 20 232 472 18 '(100 61 34))
  (fill-rect image background 20 356 472 18 '(100 61 34))
  (fill-rect image background 20 20 472 8 '(164 109 56))
  (fill-rect image background 20 484 472 8 '(164 109 56))
  (fill-rect image background 20 20 8 472 '(164 109 56))
  (fill-rect image background 484 20 8 472 '(164 109 56))
  (save-image image "rc-window-lattice.png")
  (gimp-image-delete image)
)
