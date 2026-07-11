declare module 'qrcode' {
  export interface QRCodeCreateOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' | string
    margin?: number
  }

  export interface QRCodeModules {
    size: number
    get(row: number, col: number): boolean
  }

  export interface QRCodeCreateResult {
    modules: QRCodeModules
  }

  const QRCode: {
    create(text: string, options?: QRCodeCreateOptions): QRCodeCreateResult
  }

  export default QRCode
}
