import { useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { ModeToggle, type ConvertMode } from './ConvertParts';
import { ImagesToPdf, useImagesToPdf } from './ImagesToPdf';
import { OpenPdf } from './OpenPdf';
import { PdfToImages } from './PdfToImages';

/**
 * Omzetten: afbeeldingen naar PDF, of de pagina's van een PDF naar afbeeldingen. Staat er al
 * een PDF open (bijvoorbeeld van een andere taak), dan begint het bij "PDF naar afbeeldingen".
 */
export function ConvertView() {
  const { doc } = useDocument();
  const [mode, setMode] = useState<ConvertMode>(doc.status === 'ready' ? 'pdf' : 'images');
  const images = useImagesToPdf();
  const restoreFocus = useRef(false);
  const toggle = <ModeToggle mode={mode} onChange={setMode} restoreFocus={restoreFocus} />;

  if (mode === 'images') return <ImagesToPdf state={images} head={toggle} />;
  if (doc.status === 'ready') return <PdfToImages head={toggle} />;
  return (
    <>
      <div class="convert-mode">{toggle}</div>
      <OpenPdf />
    </>
  );
}
