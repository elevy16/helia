export function resolveDocumentStoragePath(fileRow, userId) {
  const fp = fileRow.file_path != null ? String(fileRow.file_path).trim() : '';
  if (fp) return fp;
  return `${userId}/${fileRow.filename}`;
}

export function getFileRowKey(fileRow, userId) {
  if (fileRow.id != null && String(fileRow.id) !== '') return `id:${String(fileRow.id)}`;
  const fp = fileRow.file_path != null ? String(fileRow.file_path).trim() : '';
  if (fp) return `path:${fp}`;
  return `fn:${userId}:${fileRow.filename}`;
}

export function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target.result);
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function arrayBufferToBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
