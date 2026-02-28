export function generateSecurePassword(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  const array = new Uint8Array(length);
  
  window.crypto.getRandomValues(array);
  
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}