import * as UTIF from 'utif2'
import { fail } from './common'
import { tiffHeader } from './tiff-header'
import { inflateTiff } from './tiff-inflate'

type Request = { kind: 'open'; buffer: ArrayBuffer } | { kind: 'page'; index: number }
const scope = self as unknown as { onmessage: (event: MessageEvent<Request>) => void; postMessage(message: unknown): void }
let buffer: ArrayBuffer, header: ReturnType<typeof tiffHeader>

async function pageBlob(index: number) {
 const page = header.pages[index]
 if (!page) fail('a TIFF page request is invalid.')
 const normalized = [8,32946].includes(page.compression) ? inflateTiff(buffer, page) : { buffer, tags: page.tags }
 const image = { ...normalized.tags } as unknown as UTIF.IFD
 UTIF.decodeImage(normalized.buffer, image)
 if (image.width !== page.width || image.height !== page.height || image.data?.length !== page.rowBytes * page.height) fail('TIFF decoder output does not match the checked page dimensions.')
 const rgba = UTIF.toRGBA8(image)
 if (rgba.length !== page.width * page.height * 4) fail('TIFF decoder did not produce the expected raster surface.')
 const source = new OffscreenCanvas(page.width, page.height), context = source.getContext('2d')
 if (!context) fail('this browser cannot create a local TIFF raster surface.')
 context.putImageData(new ImageData(new Uint8ClampedArray(rgba), page.width, page.height), 0, 0)
 const rotated = page.orientation >= 5, output = new OffscreenCanvas(rotated ? page.height : page.width, rotated ? page.width : page.height), target = output.getContext('2d')
 if (!target) fail('this browser cannot orient a local TIFF page.')
 const w = page.width, h = page.height
 const transforms: number[][] = [[1,0,0,1,0,0],[-1,0,0,1,w,0],[-1,0,0,-1,w,h],[1,0,0,-1,0,h],[0,1,1,0,0,0],[0,1,-1,0,h,0],[0,-1,-1,0,h,w],[0,-1,1,0,0,w]]
 target.fillStyle = '#fff'; target.fillRect(0, 0, output.width, output.height)
 const [a,b,c,d,e,f] = transforms[page.orientation - 1]
 target.setTransform(a,b,c,d,e,f); target.drawImage(source, 0, 0)
 const blob = await output.convertToBlob({ type: 'image/png' })
 source.width = source.height = output.width = output.height = 0
 return blob
}

scope.onmessage = event => {
 void (async () => {
  if (event.data.kind === 'open') {
   buffer = event.data.buffer; header = tiffHeader(buffer)
   scope.postMessage({ kind: 'ready', pages: header.pages.length, notes: header.notes })
  } else scope.postMessage({ kind: 'page', blob: await pageBlob(event.data.index) })
 })().catch(error => scope.postMessage({ kind: 'error', message: error instanceof Error && error.message.startsWith('File extraction: ') ? error.message : 'File extraction: TIFF decoding failed. The codec or raster data may be unsupported or damaged.' }))
}
