/** FormData entries are string | File — these never stringify a File by accident. */

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function formNumber(formData: FormData, key: string): number {
  return Number(formString(formData, key));
}
