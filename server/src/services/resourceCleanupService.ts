import { FileUploadModel } from '@/models/FileUpload'
import { deleteStoredFile } from '@/services/uploadStorageService'

function toNormalizedUrl(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function deleteFileUploadsByUrlsIfUnreferenced(
  urls: Array<string | null | undefined>,
  isReferenced: (url: string) => Promise<boolean>,
): Promise<void> {
  const uniqueUrls = Array.from(new Set(urls.map((url) => toNormalizedUrl(url)).filter(Boolean)))
  if (!uniqueUrls.length) {
    return
  }

  const uploads = await FileUploadModel.find({ url: { $in: uniqueUrls } }).lean().exec()
  for (const upload of uploads) {
    const url = toNormalizedUrl(upload.url)
    if (!url) {
      continue
    }

    if (await isReferenced(url)) {
      continue
    }

    await Promise.all([
      deleteStoredFile(String(upload.fileKey)).catch(() => undefined),
      FileUploadModel.findByIdAndDelete(upload._id).exec(),
    ])
  }
}