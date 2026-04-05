<script lang="ts">
  import { createEventDispatcher, onMount } from "svelte";

  export let imageFile: File;

  const dispatch = createEventDispatcher();

  let canvas: HTMLCanvasElement;
  let img: HTMLImageElement;
  let imgLoaded = false;

  // Crop state
  let cropX = 0;
  let cropY = 0;
  let cropSize = 200;
  let scale = 1;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCropX = 0;
  let dragStartCropY = 0;

  // Display dimensions
  let displayW = 0;
  let displayH = 0;
  const MAX_DISPLAY = 400;

  onMount(() => {
    img = new Image();
    img.onload = () => {
      // Compute display scale
      const maxDim = Math.max(img.width, img.height);
      scale = maxDim > MAX_DISPLAY ? MAX_DISPLAY / maxDim : 1;
      displayW = Math.round(img.width * scale);
      displayH = Math.round(img.height * scale);

      // Default crop: centered square, as large as fits
      const minDim = Math.min(displayW, displayH);
      cropSize = Math.round(minDim * 0.85);
      cropX = Math.round((displayW - cropSize) / 2);
      cropY = Math.round((displayH - cropSize) / 2);

      canvas.width = displayW;
      canvas.height = displayH;
      imgLoaded = true;
      draw();
    };
    img.src = URL.createObjectURL(imageFile);

    return () => {
      if (img.src) URL.revokeObjectURL(img.src);
    };
  });

  function draw() {
    if (!canvas || !imgLoaded) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, displayW, displayH);

    // Draw image
    ctx.drawImage(img, 0, 0, displayW, displayH);

    // Dark overlay outside crop
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, displayW, cropY);
    ctx.fillRect(0, cropY + cropSize, displayW, displayH - cropY - cropSize);
    ctx.fillRect(0, cropY, cropX, cropSize);
    ctx.fillRect(cropX + cropSize, cropY, displayW - cropX - cropSize, cropSize);

    // Crop border
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, cropSize, cropSize);

    // Corner handles
    const hs = 8;
    ctx.fillStyle = "#fff";
    for (const [cx, cy] of [[cropX, cropY], [cropX + cropSize, cropY], [cropX, cropY + cropSize], [cropX + cropSize, cropY + cropSize]]) {
      ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    }
  }

  function clamp(val: number, min: number, max: number) {
    return Math.max(min, Math.min(max, val));
  }

  function onMouseDown(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Check if near a corner for resizing
    const corners = [
      { x: cropX + cropSize, y: cropY + cropSize, cursor: "nwse" },
      { x: cropX, y: cropY, cursor: "nwse" },
      { x: cropX + cropSize, y: cropY, cursor: "nesw" },
      { x: cropX, y: cropY + cropSize, cursor: "nesw" },
    ];

    for (const c of corners) {
      if (Math.abs(mx - c.x) < 12 && Math.abs(my - c.y) < 12) {
        // Start resize from bottom-right conceptually
        startResize(e, mx, my);
        return;
      }
    }

    // Check if inside crop area for dragging
    if (mx >= cropX && mx <= cropX + cropSize && my >= cropY && my <= cropY + cropSize) {
      dragging = true;
      dragStartX = mx;
      dragStartY = my;
      dragStartCropX = cropX;
      dragStartCropY = cropY;
    }
  }

  let resizing = false;
  let resizeStartX = 0;
  let resizeStartY = 0;
  let resizeStartSize = 0;

  function startResize(e: MouseEvent, mx: number, my: number) {
    resizing = true;
    resizeStartX = mx;
    resizeStartY = my;
    resizeStartSize = cropSize;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging && !resizing) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (resizing) {
      const delta = Math.max(mx - resizeStartX, my - resizeStartY);
      const newSize = clamp(resizeStartSize + delta, 50, Math.min(displayW, displayH));
      cropSize = newSize;
      cropX = clamp(cropX, 0, displayW - cropSize);
      cropY = clamp(cropY, 0, displayH - cropSize);
      draw();
      return;
    }

    if (dragging) {
      const dx = mx - dragStartX;
      const dy = my - dragStartY;
      cropX = clamp(dragStartCropX + dx, 0, displayW - cropSize);
      cropY = clamp(dragStartCropY + dy, 0, displayH - cropSize);
      draw();
    }
  }

  function onMouseUp() {
    dragging = false;
    resizing = false;
  }

  async function handleCrop() {
    // Crop from the original image
    const origScale = img.width / displayW;
    const sx = Math.round(cropX * origScale);
    const sy = Math.round(cropY * origScale);
    const ss = Math.round(cropSize * origScale);

    const outSize = 512; // output square size
    const outCanvas = document.createElement("canvas");
    outCanvas.width = outSize;
    outCanvas.height = outSize;
    const ctx = outCanvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, ss, ss, 0, 0, outSize, outSize);

    outCanvas.toBlob((blob) => {
      if (blob) {
        const croppedFile = new File([blob], imageFile.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
        dispatch("crop", { file: croppedFile });
      }
    }, "image/jpeg", 0.9);
  }

  function handleCancel() {
    dispatch("cancel");
  }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" on:mouseup={onMouseUp} on:mousemove={onMouseMove}>
  <div class="bg-base-100 rounded-xl shadow-2xl max-w-[480px] w-full p-5">
    <h3 class="font-bold text-lg mb-3">Crop Photo</h3>
    <p class="text-sm text-base-content/60 mb-3">Drag to move, drag corners to resize.</p>

    <div class="flex justify-center mb-4">
      <canvas
        bind:this={canvas}
        class="rounded-lg cursor-move border border-base-300"
        style="max-width:100%; width:{displayW}px; height:{displayH}px;"
        on:mousedown={onMouseDown}
      />
    </div>

    <div class="flex justify-end gap-2">
      <button class="btn btn-sm btn-ghost" on:click={handleCancel}>Cancel</button>
      <button class="btn btn-sm btn-primary" on:click={handleCrop}>Crop & Upload</button>
    </div>
  </div>
</div>
