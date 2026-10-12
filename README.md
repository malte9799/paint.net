# paint.net web

A recreation of the [paint.net](https://www.getpaint.net/) image editor that runs entirely in the browser. It is a static site (plain HTML, CSS and ES modules, with no build step), so it can be hosted on GitHub Pages or any static file server.

> paint.net is a trademark of dotPDN LLC. This is an independent, unofficial project. It is not affiliated with or endorsed by dotPDN LLC. All icons and code here are original.

## Features

**Layout** (modeled on paint.net 5)
- Menu bar (File, Edit, View, Image, Layers, Adjustments, Effects), a toolbar with image thumbnail tabs, the tool options bar and a status bar with a zoom slider.
- Floating **Tools**, **History**, **Layers** and **Colors** windows. You can drag them, resize History and Layers, toggle them with F5–F8, and they turn translucent when the pointer isn't over them.
- Light, dark or system theme, with an accent color setting.
- Rulers (pixels, inches or centimeters), a pixel grid at high zoom, and marching-ants selection outlines.

**Tools** (with paint.net's keyboard shortcuts)
Move Selected Pixels / Move Selection (M), Rectangle / Ellipse / Lasso Select and Magic Wand (S), Zoom (Z), Pan (H or hold Space), Paint Bucket (F), Gradient (G: linear, reflected, diamond, radial, conical, spiral; color or transparency mode), Paintbrush (B, with hardness), Eraser (E), Pencil (P), Color Picker (K), Clone Stamp (L, Ctrl+click to set the source), Recolor (R), Text (T), Line/Curve (O, editable spline with dashes and arrows) and Shapes (O, 15 shapes: outline, fill, or fill with outline).

- Selection modes: replace, union, exclude, intersect and xor. You can also hold Ctrl or Alt, or use the right mouse button.
- Move Selected Pixels: drag to move, use the handles to scale, right-drag to rotate. Ctrl-drag leaves a copy behind.
- Gradients, text, lines and shapes stay editable until you press Enter or switch tools.
- Antialiasing, blend modes (including Overwrite), tolerance and sampling options work as they do in paint.net.

**Layers**: add, delete, duplicate, merge down, import from file, flip, Rotate/Zoom, and Layer Properties (name, visibility, blend mode, opacity). You can reorder layers by dragging them. There are 20 layer blend modes.

**Adjustments**: Auto-Level, Black and White, Brightness/Contrast, Curves (luminosity or RGB), Hue/Saturation, Invert Colors, Levels, Posterize and Sepia.

**Effects**: Artistic (Ink Sketch, Oil Painting, Pencil Sketch), Blurs (Fragment, Gaussian, Motion, Radial, Surface, Unfocus, Zoom), Distort (Bulge, Dents, Frosted Glass, Pixelate, Polar Inversion, Tile Reflection, Twist), Noise (Add Noise, Median, Reduce Noise), Object (Drop Shadow), Photo (Glow, Red Eye Removal, Sharpen, Soften Portrait, Vignette), Render (Clouds, Julia and Mandelbrot fractals) and Stylize (Edge Detect, Emboss, Outline, Relief).
Effects show a live preview, run in a Web Worker, apply only inside the selection, and can be repeated with Ctrl+F.

**Image**: Crop to Selection, Resize (with a choice of resampling), Canvas Size (with an anchor), Flip, Rotate 90°/180°, and Flatten.

**History**: unlimited undo and redo, up to 250 steps. Click any history item to jump to that state.

**Files**
- Opens PNG, JPEG, GIF, WebP, BMP, ICO, AVIF, SVG, TGA and OpenRaster (`.ora`, layered). You can drop files onto the window or paste images from the clipboard.
- Saves PNG, JPEG and WebP (with a quality setting), BMP, TGA and OpenRaster (`.ora`, which keeps layers and blend modes). In Chromium-based browsers, Save writes back to the original file through the File System Access API. Other browsers download the file instead.
- Copy, Copy Merged, Cut, Paste, Paste into New Layer and Paste into New Image use the system clipboard.
- Print.

## Storage

- **IndexedDB** holds the open images, with all their layers, so they come back when you reload. It also holds the *Open Recent* list.
- **localStorage** holds settings: theme, window positions, colors, palette, tool options, units and so on.
- You can clear both from **Settings** (the gear icon).

## Running locally

ES modules need to be served over HTTP; opening `index.html` as a `file://` URL won't work. Any static server will do:

```sh
npx http-server -c-1 .
# or
python3 -m http.server
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the repository root on every push to `main`. To turn it on, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. You can also choose *Deploy from a branch* and pick the branch root. The `.nojekyll` file stops Jekyll from processing the site.

## Keyboard shortcuts

Most of paint.net's shortcuts work, for example Ctrl+Z/Y, Ctrl+A/D/I, Ctrl+X/C/V, Ctrl+Shift+V, Ctrl+R (resize), Ctrl+Shift+R (canvas size), Ctrl+Shift+X (crop), Ctrl+H/G/J (rotate), Ctrl+Shift+N/D (new or duplicate layer), Ctrl+M (merge down), F4 (layer properties), Ctrl+Shift+F (flatten), Ctrl+L (levels), Ctrl+Shift+I/G/U/E/P/M/L for the adjustments, Ctrl+B (zoom to window), Ctrl+0 (actual size), Ctrl+'+'/'-' (zoom), X (swap colors), and [ / ] (brush width). Press **F1** to see the full list.

Browsers reserve a few shortcuts, such as Ctrl+N, Ctrl+W and Ctrl+Tab in most of them. Those commands are still in the menus.

## Differences from the desktop app

This is a close functional recreation, not a port. The icons are original artwork. Effect algorithms are approximations of paint.net's. It can't open the native `.pdn` format, so use OpenRaster (`.ora`) to save layered images. Plugins, scanner/camera acquisition and some lesser-used options are not included.

## Project structure

```
index.html            entry point
css/app.css           all styling (light and dark themes)
js/app.js             application state, documents, keyboard, persistence
js/document.js        Document/Layer model and layer blending
js/history.js         undo/redo
js/selection.js       mask-based selection and outline tracing
js/view.js            canvas viewport: zoom, scroll, rulers, input
js/commands.js        every menu command
js/tools/*            the 19 tools
js/effects/*          adjustments/effects, the worker and the effect dialogs
js/ui/*               menus, toolbars, floating windows, dialogs
js/fileio.js, formats.js, storage.js   files, codecs (ORA/ZIP, BMP, TGA), IndexedDB/localStorage
```
