import { useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";

/**
 * Scans a barcode with the device camera. Live camera access needs HTTPS (or localhost), so it
 * also offers "take a photo" (works over plain HTTP on phones) and typing the number by hand.
 */
export function BarcodeScanner({ onDetected }: { onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const liveSupported = typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

  useEffect(() => {
    if (!liveSupported || !videoRef.current) return;
    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let stopped = false;
    reader
      .decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result, _err, ctrl) => {
        if (result && !stopped) {
          stopped = true;
          ctrl.stop();
          navigator.vibrate?.(80);
          onDetected(result.getText());
        }
      })
      .then((c) => {
        controls = c;
        if (stopped) c.stop();
      })
      .catch(() => setCameraError("Couldn't open the camera. Allow camera access, or take a photo / type the number below."));
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [liveSupported, onDetected]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoError(null);
    const url = URL.createObjectURL(file);
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      onDetected(result.getText());
    } catch {
      setPhotoError("No barcode found in that photo. Get closer, keep it sharp and well lit, and try again.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const code = manual.replace(/\D/g, "");
    if (code) onDetected(code);
  };

  return (
    <div className="stack">
      {liveSupported && !cameraError ? (
        <div className="scanner">
          <video ref={videoRef} muted playsInline />
          <div className="scanner-frame" aria-hidden />
          <p className="scanner-hint">Point the camera at the barcode</p>
        </div>
      ) : (
        <p className="note">
          {cameraError ??
            "Live scanning needs the app to be opened over HTTPS. You can still take a photo of the barcode or type the number."}
        </p>
      )}

      <label className="secondary file-button">
        📷 Take a photo of the barcode
        <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} hidden />
      </label>
      {photoError && <p className="error">{photoError}</p>}

      <form className="row" onSubmit={submitManual}>
        <input
          className="grow"
          inputMode="numeric"
          placeholder="Or type the barcode number"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
        />
        <button className="primary">Look up</button>
      </form>
    </div>
  );
}
