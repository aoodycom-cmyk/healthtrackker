(function () {
  let stream = null;
  let detector = null;

  function isSupported() {
    return "BarcodeDetector" in window && navigator.mediaDevices?.getUserMedia;
  }

  async function start(video) {
    if (!isSupported()) {
      throw new Error("Barcode scanning is not supported in this browser. Use manual barcode entry.");
    }
    detector = detector || new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    await video.play();
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
  }

  async function scanFrame(video) {
    if (!detector) throw new Error("Scanner is not running.");
    const results = await detector.detect(video);
    return results[0]?.rawValue || "";
  }

  async function scanUntilFound(video, onCode, onError) {
    try {
      await start(video);
      let active = true;
      const loop = async () => {
        if (!active) return;
        try {
          const code = await scanFrame(video);
          if (code) {
            active = false;
            stop();
            onCode(code);
            return;
          }
        } catch (error) {
          active = false;
          stop();
          onError(error);
          return;
        }
        requestAnimationFrame(loop);
      };
      loop();
      return () => {
        active = false;
        stop();
      };
    } catch (error) {
      stop();
      onError(error);
      return () => {};
    }
  }

  window.BarcodeService = { isSupported, start, stop, scanFrame, scanUntilFound };
})();
