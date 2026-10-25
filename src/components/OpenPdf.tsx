import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { Dropzone } from './Dropzone';
import { FileErrors, useErrorText } from './WorkspaceParts';

/** Het vak om PDF's te openen, met de melding als het laden bezig is of mislukte. */
export function OpenPdf() {
  const { doc, open } = useDocument();
  const { t } = useI18n();
  const errorText = useErrorText();

  return (
    <Dropzone
      title={t.document.openTitle}
      dropTitle={t.document.dropHere}
      hint={t.document.openHint}
      inputId="pdf-file"
      accept="application/pdf,.pdf"
      chooseLabel={t.document.choose}
      onFiles={(files) => void open(files)}
    >
      {doc.status === 'loading' && (
        <p class="dropzone__status" role="status">
          {format(t.document.loading, { name: doc.name })}
        </p>
      )}
      {doc.status === 'error' && (
        <p class="dropzone__error" role="alert">
          {errorText(doc)}
        </p>
      )}
      <FileErrors />
    </Dropzone>
  );
}
