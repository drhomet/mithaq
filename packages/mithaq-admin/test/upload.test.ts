// The JSX loader and the DOM are imported first for their side effects; registry files load
// through dynamic import after both.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { act, createElement, useState, type ReactElement } from 'react'
import { asas } from 'asas'
import { ScreenContext, type ScreenState } from 'mithaq/admin/react'
import './tsx.ts'
import { click, fire, mount, window, type as typeInto } from './dom.ts'

const { createRoot } = await import('react-dom/client')
const { withAddOns } = await import('./with-add-ons.ts')
// The template's language holds rich text and files, so its screens draw with both add-ons spread in, as its apps do.
const defaultComponents = withAddOns((await import('../registry/default-components.tsx')).defaultComponents, (await import('../registry/rich-text.tsx')).richTextComponents, (await import('../registry/upload.tsx')).uploadComponents)
const { ComponentsProvider } = await import('../registry/components.tsx')
const controls: Readonly<Record<string, import('../registry/control-props.ts').Control>> = defaultComponents.controls
const cells: Readonly<Record<string, import('../registry/control-props.ts').Cell>> = defaultComponents.cells
const { FieldValue } = await import('../registry/field-value.tsx')
const { useRelationshipTitles } = await import('../registry/relationship-cell.tsx')
const upload = await import('../registry/upload.tsx')
const { UploadPlugin, UploadView, imagePick } = await import('../registry/upload-node.tsx')
const { RichTextContext, RichTextControl, RichTextViewer, defaultPicks, defaultViews, viewsOf } = await import('../registry/rich-text.tsx')
const { defaultNodes, UploadNode } = await import('mithaq/rich-text')
type ClientField = import('mithaq/admin').ClientField
type FetchClient = import('mithaq/admin').FetchClient

const screen = asas.targets.dashboard.client
const courses = screen.kayan.courses!
const media = screen.kayan.media!
const cover = courses.fields.find((one) => one.name === 'cover')!
const t = (_key: string, fallback?: string) => fallback

const png = { id: 'a1', filename: 'cover.png', mimeType: 'image/png', alt: { en: 'A cover', ar: 'غلاف' }, url: '/api/media/file/a1', thumbnailURL: '/api/media/file/a1' }
const pdf = { id: 'b2', filename: 'notes.pdf', mimeType: 'application/pdf', url: '/api/media/file/b2', thumbnailURL: null }
const stored: Record<string, unknown>[] = [png, pdf, ...['c3', 'd4', 'e5'].map((id) => ({ ...png, id, url: `/api/media/file/${id}`, thumbnailURL: `/api/media/file/${id}` }))]

const clientOf = (asked: { operation: string; input: Record<string, unknown> }[], answers: Record<string, (input: Record<string, unknown>) => unknown> = {}): FetchClient =>
  async ({ operation, input }) => {
    asked.push({ operation, input })
    if (answers[operation]) return answers[operation]!(input)
    const where = (input.where ?? {}) as { id?: { in?: string[]; equals?: string; not_in?: string[] } }
    const docs = stored.filter((row) => (where.id?.in ? where.id.in.includes(String(row.id)) : where.id?.equals ? where.id.equals === row.id : !where.id?.not_in?.includes(String(row.id))))
    return { docs, hasNextPage: false, nextPage: null }
  }
const apiOf = (client: FetchClient) => ({ media: { find: (input: Record<string, unknown>) => client({ kayan: 'media', operation: 'find', input }) as never } })

let mounted: ReturnType<typeof createRoot> | undefined
const mayCreate = { collections: { media: { create: true, operations: { create: true }, fields: { alt: { create: true } } } } } as unknown as ScreenState['access']
const render = async (element: ReactElement, client: FetchClient = clientOf([]), access: ScreenState['access'] = mayCreate, over: Partial<ScreenState> = {}) => {
  const previous = mounted
  if (previous) await act(async () => previous.unmount())
  const host = mount()
  const root = createRoot(host)
  mounted = root
  const state: ScreenState = { t, locale: 'en', dir: 'ltr', screen, access, user: { name: 'Admin', email: 'admin@example.com' }, client, ...over }
  await act(async () => root.render(createElement(ScreenContext, { value: state }, createElement(ComponentsProvider, { components: defaultComponents }, element))))
  await act(async () => sleep(20))
  return host
}

const controlOf = (props: { value: unknown; onChange?: (next: unknown) => void; readOnly?: boolean; field?: ClientField; client?: FetchClient }) => {
  const client = props.client ?? clientOf([])
  return createElement(controls.upload!, {
    field: props.field ?? cover, kayan: courses, client: [media], api: apiOf(client), id: 'courses-cover', t, locale: 'en', locales: ['ar', 'en'],
    value: props.value, values: {}, setValue: () => {}, readOnly: props.readOnly ?? false, onChange: props.onChange ?? (() => {}),
  })
}

const sends: { url: string; headers: Record<string, string> }[] = []
let putStatus = 204
class FakeRequest {
  upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  status = 0
  responseText = ''
  private url = ''
  private headers: Record<string, string> = {}
  open(_method: string, url: string) {
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send() {
    sends.push({ url: this.url, headers: this.headers })
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
    this.status = putStatus
    this.responseText = putStatus === 204 ? '' : JSON.stringify({ message: 'The upload is not the size that was signed.' })
    setTimeout(() => this.onload?.(), 0)
  }
}
Reflect.set(globalThis, 'XMLHttpRequest', FakeRequest)

test('186u. a file is refused before it is sent for a type the kayan does not take, a size past its limit or no bytes, with the words the server would use', () => {
  const storage = media.storage!
  assert.equal(upload.refusedFile({ type: 'image/png', size: 10 }, storage), undefined)
  assert.equal(upload.refusedFile({ type: 'text/plain', size: 10 }, storage), 'error.invalid.upload_type')
  assert.equal(upload.refusedFile({ type: '', size: 10 }, storage), 'error.invalid.upload_type')
  assert.equal(upload.refusedFile({ type: 'image/svg+xml', size: 10 }, { mimeTypes: ['image/*'], fileSize: 100 }), 'error.invalid.upload_type', 'a wildcard never takes an SVG')
  assert.equal(upload.refusedFile({ type: 'image/gif', size: 10 }, { mimeTypes: ['image/*'], fileSize: 100 }), undefined)
  assert.equal(upload.refusedFile({ type: 'image/png', size: storage.fileSize + 1 }, storage), 'error.invalid.upload_size')
  assert.equal(upload.refusedFile({ type: 'image/png', size: 0 }, storage), 'error.invalid.upload_request')
})

test('186v. an upload asks for instructions, sends the bytes where they say with their headers, and creates the row with the signed reference beside its own fields', async () => {
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  const sent: unknown[] = []
  const fractions: number[] = []
  const client = clientOf(asked, {
    uploadInstructions: () => ({ type: 'http', request: { method: 'PUT', url: '/api/storage/local/token', headers: { 'Content-Type': 'image/png' } }, file: { uploadReference: { id: 'n1' } } }),
    create: (input) => ({ id: 'n1', ...input }),
  })
  const file = new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' })
  const row = await upload.uploadFile({ client, kayan: 'media', file, data: { alt: { en: 'A', ar: 'أ' } }, progress: (one) => void fractions.push(one), send: async ({ request, file: body, progress }) => void (sent.push([request.url, request.headers?.['Content-Type'], body === file]), progress(0.5)) })
  assert.deepEqual(asked.map((one) => one.operation), ['uploadInstructions', 'create'])
  assert.deepEqual(asked[0]!.input, { filename: 'cover.png', filesize: 3, mimeType: 'image/png' })
  assert.deepEqual(sent, [['/api/storage/local/token', 'image/png', true]])
  assert.deepEqual(asked[1]!.input, { alt: { en: 'A', ar: 'أ' }, uploadReference: { id: 'n1' } })
  assert.deepEqual(fractions, [0.5, 1])
  assert.equal(row.id, 'n1')
})

test('186w. the control draws the held file by its thumbnail with Choose and Upload new, the choices with thumbnails, and read-only the image alone', async () => {
  const host = await render(controlOf({ value: 'a1' }))
  assert.equal(host.querySelector('[data-upload-thumbnail]')?.getAttribute('src'), '/api/media/file/a1', 'drawn off the row\'s computed thumbnailURL')
  assert.equal(host.querySelector('[data-upload-thumbnail]')?.getAttribute('alt'), 'A cover', 'named by its alternative text in the viewer\'s locale')
  assert.equal(host.querySelector('#courses-cover')?.getAttribute('role'), 'combobox', 'Choose is the relationship\'s own picker')
  assert.equal(host.querySelector('[data-upload-new]')?.textContent, 'Upload new')
  await act(async () => click(host.querySelector('#courses-cover')!))
  await act(async () => sleep(20))
  const options = [...window.document.querySelectorAll('[role="option"]')]
  assert.equal(options.length > 0, true, 'the picker lists the kayan\'s files')
  assert.equal(options.every((one) => one.querySelector('img[data-upload-thumbnail]') !== null || one.textContent?.includes('notes.pdf') === true), true, 'each with its thumbnail where it is an image')

  const read = await render(controlOf({ value: 'b2', readOnly: true }))
  assert.equal(read.querySelector('[data-upload-file]')?.textContent?.includes('notes.pdf'), true, 'a file that is no image is its name')
  assert.equal(read.querySelector('[data-upload-file]')?.textContent?.includes('application/pdf'), true, 'and its type')
  assert.equal(read.querySelectorAll('button').length + read.querySelectorAll('[role="combobox"]').length, 0, 'and read-only offers nothing to change')
})

test('186x. Upload new refuses a file of another type before sending, offers a retry after a failed send and none after the server refused the file, and sets the field to the new row once it is made, saying so in a toast', async (context) => {
  const { toast } = await import('../registry/toast.tsx')
  const toasts = context.mock.method(toast, 'success', () => 0)
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  let refuse = true
  const client = clientOf(asked, {
    uploadInstructions: () => ({ type: 'http', request: { method: 'PUT', url: '/api/storage/local/token', headers: { 'Content-Type': 'image/png', 'Content-Length': '3' } }, file: { uploadReference: { id: 'n1' } } }),
    create: (input) => {
      if (refuse) {
        refuse = false
        throw Object.assign(new Error('The uploaded file was refused: it is text.'), { data: { key: 'error.invalid.upload_verify' } })
      }
      return { ...png, id: 'n1', ...input }
    },
  })
  const reported: unknown[] = []
  const host = await render(controlOf({ value: null, onChange: (next) => void reported.push(next), client }), client)
  await act(async () => click(host.querySelector('[data-upload-new]')!))
  await act(async () => sleep(20))
  const dialog = () => window.document.querySelector('[data-upload-dialog="media"]') as unknown as Element
  const retry = () => [...dialog().querySelectorAll('button')].find((one) => one.textContent === 'Try again') as unknown as Element | undefined
  assert.equal(dialog() !== null, true, 'the dialog opens')
  assert.equal(dialog().querySelectorAll('#upload-media-alt, #upload-media-alt-ar').length, 2, 'asking the alternative text in each locale')
  const input = dialog().querySelector('input[type="file"]') as unknown as HTMLInputElement
  assert.equal(input.getAttribute('accept'), 'image/png,image/jpeg,image/webp')
  const choose = async (file: File) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => fire(input as unknown as Element, 'change'))
  }
  await choose(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
  assert.equal(dialog().querySelector('[data-upload-refused]')?.textContent?.includes('error.invalid.upload_type'), true, 'a type the kayan does not take is refused at once')
  assert.equal(retry() === undefined, true, 'with nothing to retry')
  await act(async () => fire(dialog().querySelector('form')!, 'submit'))
  assert.equal(asked.some((one) => one.operation === 'uploadInstructions'), false, 'and never sent')

  putStatus = 500
  await choose(new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' }))
  await act(async () => typeInto(dialog().querySelector('#upload-media-alt')!, 'A cover'))
  await act(async () => typeInto(dialog().querySelector('#upload-media-alt-ar')!, 'غلاف'))
  await act(async () => fire(dialog().querySelector('form')!, 'submit'))
  await act(async () => sleep(20))
  assert.equal(sends.at(-1)?.url, '/api/storage/local/token', 'the bytes go where the instructions say')
  assert.equal(sends.at(-1)?.headers['Content-Type'], 'image/png', 'with their headers')
  assert.equal('Content-Length' in (sends.at(-1)?.headers ?? {}), false, 'less the one the browser sets itself')
  assert.equal(dialog().querySelector('[data-upload-refused]')?.textContent?.includes('not the size that was signed'), true, 'the store\'s own refusal is shown')
  assert.equal(retry() !== undefined, true, 'with a retry')
  putStatus = 204
  await act(async () => click(retry()!))
  await act(async () => sleep(20))
  assert.equal(dialog().querySelector('[data-upload-refused]')?.textContent?.includes('it is text'), true, 'the server\'s refusal is shown')
  assert.equal(retry() === undefined, true, 'and no retry, since the same file is refused again')
  assert.equal(reported.length, 0, 'and the field is not set')

  await choose(new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' }))
  await act(async () => fire(dialog().querySelector('form')!, 'submit'))
  await act(async () => sleep(20))
  assert.deepEqual(reported, ['n1'], 'the field is set to the new row')
  assert.deepEqual(asked.filter((one) => one.operation === 'create').at(-1)?.input, { alt: { en: 'A cover', ar: 'غلاف' }, uploadReference: { id: 'n1' } })
  assert.equal(window.document.querySelector('[data-upload-dialog="media"]') === null, true, 'and the dialog closes')
  assert.deepEqual(toasts.mock.calls.map((one) => one.arguments[0]), ['media created'], 'with a green toast that it was made')
})

test('186af. Upload new is offered only to an actor the report lets create a file, and Choose to everyone who may edit the field', async () => {
  const host = await render(controlOf({ value: null }), clientOf([]), { collections: { media: { create: false } } } as unknown as ScreenState['access'])
  assert.equal(host.querySelector('[data-upload-new]') === null, true)
  assert.equal(host.querySelector('#courses-cover')?.getAttribute('role'), 'combobox')
})

function Held({ field, first, reported }: { field: ClientField; first: string[]; reported: unknown[] }): ReactElement {
  const [value, setValue] = useState<unknown>(first)
  return controlOf({ field, value, onChange: (next) => (reported.push(next), setValue(next)) })
}

test('186y. a set is a grid of files, each removed or moved by a button a keyboard reaches, the focus kept on a button of the same tile at either end and on the next file once one is removed, and Add appends', async () => {
  const gallery = { ...cover, name: 'gallery', hasMany: true as const }
  const reported: unknown[] = []
  const host = await render(createElement(Held, { field: gallery, first: ['a1', 'b2', 'c3'], reported }))
  const focused = () => String(window.document.activeElement?.id ?? '')
  const press = async (id: string) => {
    const button = host.querySelector(`#${id}`) as unknown as HTMLElement
    button.focus()
    await act(async () => click(button as unknown as Element))
    await act(async () => sleep(20))
  }
  assert.equal(host.querySelectorAll('[data-upload-tile]').length, 3)
  assert.equal(host.querySelector('#courses-cover-a1-earlier')?.hasAttribute('disabled'), true, 'the first moves no earlier')
  assert.equal(host.querySelector('#courses-cover-c3-later')?.hasAttribute('disabled'), true, 'the last no later')
  assert.equal(host.querySelector('#courses-cover-b2-remove')?.getAttribute('aria-label'), 'Remove notes.pdf', 'each button names its file')
  assert.equal(host.querySelector('#courses-cover-b2-later')?.getAttribute('aria-label'), 'Move notes.pdf later')
  await press('courses-cover-a1-later')
  assert.deepEqual(reported.at(-1), ['b2', 'a1', 'c3'])
  assert.equal(focused(), 'courses-cover-a1-later', 'the keyboard stays on the button')
  await press('courses-cover-a1-later')
  assert.deepEqual(reported.at(-1), ['b2', 'c3', 'a1'])
  assert.equal(focused(), 'courses-cover-a1-earlier', 'at the end, on the same tile\'s other move')
  await press('courses-cover-c3-earlier')
  assert.deepEqual(reported.at(-1), ['c3', 'b2', 'a1'], 'moved to the start')
  assert.equal(focused(), 'courses-cover-c3-later', 'at the start, on the same tile\'s other move')
  await press('courses-cover-b2-remove')
  assert.deepEqual(reported.at(-1), ['c3', 'a1'])
  assert.equal(focused(), 'courses-cover-a1-remove', 'a removal moves the keyboard to the next file')
  await press('courses-cover-a1-remove')
  assert.deepEqual(reported.at(-1), ['c3'])
  assert.equal(focused(), 'courses-cover-c3-remove', 'or the one before it')
  await press('courses-cover-c3-remove')
  assert.deepEqual(reported.at(-1), [])
  assert.equal(focused(), 'courses-cover', 'or the picker that adds one')
  assert.equal(host.querySelector('#courses-cover')?.getAttribute('role'), 'combobox', 'Add is the picker')
})

// One reader for every render: a new one each render would read the page again each time.
const cellApi = apiOf(clientOf([]))
function Titled({ field, value, draw }: { field: ClientField; value: unknown; draw: 'cell' | 'value' }): ReactElement {
  const titles = useRelationshipTitles({ fields: [field], docs: [{ [field.name]: value }], context: { api: cellApi, client: [media], locale: 'en' } })
  return draw === 'cell'
    ? createElement('div', null, cells.upload!({ kayan: courses, field, value, t, locale: 'en', titles }) as ReactElement)
    : createElement(upload.UploadValue, { kayan: courses, field, value, t, locale: 'en', titles })
}

test('186z. the cell is a small thumbnail for an image and the name for any other file, a set its first three and a count, and a record page the image or a download link', async () => {
  const one = await render(createElement(Titled, { field: cover, value: 'a1', draw: 'cell' }))
  assert.equal(one.querySelector('img')?.getAttribute('src'), '/api/media/file/a1')
  assert.equal(one.querySelector('img')?.getAttribute('class')?.includes('size-8'), true, 'small')
  const named = await render(createElement(Titled, { field: cover, value: 'b2', draw: 'cell' }))
  assert.equal(named.textContent, 'notes.pdf')
  const many = await render(createElement(Titled, { field: { ...cover, hasMany: true }, value: ['a1', 'c3', 'd4', 'e5', 'b2'], draw: 'cell' }))
  assert.equal(many.querySelectorAll('img').length, 3)
  assert.equal(many.textContent?.includes('and 2 more'), true)

  const image = await render(createElement(Titled, { field: cover, value: 'a1', draw: 'value' }))
  assert.equal(image.querySelector('a')?.getAttribute('href'), '/api/media/file/a1', 'the image opens the file through its route')
  assert.equal(image.querySelector('img')?.getAttribute('class')?.includes('max-h-64'), true, 'drawn whole')
  const file = await render(createElement(Titled, { field: cover, value: 'b2', draw: 'value' }))
  assert.equal(file.querySelector('[data-upload-download]')?.getAttribute('href'), '/api/media/file/b2')
  assert.equal(file.querySelector('[data-upload-download]')?.getAttribute('download'), 'notes.pdf')
  const page = await render(createElement(FieldValue, { field: cover, kayan: courses, kayans: [media], api: cellApi, row: { id: 'c1', cover: 'a1' }, copy: { t, locale: 'en' } }))
  assert.equal(page.querySelector('img')?.getAttribute('class')?.includes('max-h-64'), true)
})

const richOf = (...children: unknown[]) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } })
const uploadNode = (relationTo: string, value: string) => ({ type: 'upload', version: 3, format: '', id: 'n0', relationTo, value, fields: null })
const provided = { nodes: viewsOf([...defaultNodes, UploadNode], [...defaultViews, UploadView]), picks: [...defaultPicks, imagePick], Plugin: UploadPlugin }

test('186aa. the viewer draws an upload node from its row through the file route, and a file the viewer may not read, or of a kayan holding no files, as a placeholder', async () => {
  const viewer = (value: unknown) => createElement(RichTextContext, { value: provided }, createElement(RichTextViewer, { value, direction: 'ltr', t }))
  const drawn = await render(viewer(richOf(uploadNode('media', 'a1'))))
  assert.equal(drawn.querySelector('[data-upload-node] img')?.getAttribute('src'), '/api/media/file/a1')
  const hidden = await render(viewer(richOf(uploadNode('media', 'zz'))))
  assert.equal(hidden.querySelector('[data-upload-node] [data-upload-missing]') !== null, true, 'a row the find does not answer is the placeholder')
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  const elsewhere = await render(viewer(richOf(uploadNode('courses', 'a1'))), clientOf(asked))
  assert.equal(elsewhere.querySelector('[data-upload-missing]') !== null, true)
  assert.equal(asked.length, 0, 'and a kayan holding no files is never asked')
})

test('186ab. the / menu\'s Image opens the upload control in a dialog, and the file chosen there is put in the text as Payload\'s upload node', async () => {
  const changes: unknown[] = []
  const host = await render(createElement(RichTextContext, { value: provided }, createElement(RichTextControl, {
    field: courses.fields.find((one) => one.name === 'details')!, kayan: courses, client: [media], id: 'courses-details', t, locale: 'en', locales: ['ar', 'en'],
    value: richOf({ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, textFormat: 0, textStyle: '', children: [] }), values: {}, setValue: () => {}, readOnly: false, onChange: (next: unknown) => void changes.push(next),
  })))
  assert.equal(provided.picks.some((one) => one.key === 'upload' && one.label.en === 'Image' && one.label.ar === 'صورة'), true)
  const editor = (host.querySelector('#courses-details') as unknown as { __lexicalEditor: import('lexical').LexicalEditor }).__lexicalEditor
  await act(async () => imagePick.onSelect({ editor, isActive: false }))
  await act(async () => sleep(20))
  const dialog = window.document.querySelector('[data-upload-insert]') as unknown as Element
  assert.equal(dialog !== null, true, 'the dialog opens')
  assert.equal(dialog.querySelector('[data-upload-new]') !== null, true, 'offering an upload')
  await act(async () => click(dialog.querySelector('[role="combobox"]')!))
  await act(async () => sleep(20))
  const option = [...window.document.querySelectorAll('[role="option"]')].find((one) => one.textContent?.includes('cover.png'))
  await act(async () => click(option as unknown as Element))
  await act(async () => sleep(20))
  const last = changes.at(-1) as { root: { children: Record<string, unknown>[] } }
  const node = last.root.children.find((one) => one.type === 'upload')!
  assert.equal(node.relationTo, 'media')
  assert.equal(node.value, 'a1')
  assert.equal(node.version, 3)
  assert.equal(typeof node.id === 'string' && /^[0-9a-f]{24}$/.test(node.id), true, 'with a node id as Payload makes one')
  assert.equal(window.document.querySelector('[data-upload-insert]') === null, true, 'and the dialog closes')
  assert.equal(host.querySelector('[data-upload-node] img')?.getAttribute('src'), '/api/media/file/a1', 'the editor draws it')
  await act(async () => mounted?.unmount())
  mounted = undefined
})

test('214. the upload cell and control never show a file\'s id: loading until the read answers, a dash where it failed, and a row the viewer cannot see where it was refused or left out', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server')
  const cell = (titles: Map<string, unknown> | undefined) =>
    renderToStaticMarkup(createElement('div', null, cells.upload!({ kayan: courses, field: cover, value: 'zz9', t, locale: 'en', titles: titles as never }) as ReactElement))
  assert.ok(cell(undefined).includes('Loading…') && !cell(undefined).includes('zz9'), 'the server render reads as loading')
  assert.ok(cell(new Map([['row:media:zz9', false]])).includes('Not available'), 'a row the read was refused is not available')
  assert.ok(cell(new Map([['row:media:zz9', true]])).includes('Deleted'), 'and one it answered without is gone')
  assert.ok(cell(new Map([['row:media:zz9', new Error('network')]])).includes('—'), 'a failed read is a dash')
  for (const titles of [undefined, new Map([['row:media:zz9', false]]), new Map([['row:media:zz9', new Error('network')]])]) assert.ok(!cell(titles).includes('zz9'), 'and none draws the id')

  const forbidden = Object.assign(new Error('Forbidden.'), { status: 403 })
  const drawn = async (client: FetchClient) => (await render(controlOf({ value: 'zz9', readOnly: true, client }))).textContent ?? ''
  const missing = await drawn(clientOf([]))
  assert.ok(missing.includes('Deleted') && !missing.includes('zz9'), `a file the answer left out: ${missing}`)
  const refused = await drawn(async () => { throw forbidden })
  assert.ok(refused.includes('Not available') && !refused.includes('zz9'), `a 403: ${refused}`)
  const failed = await drawn(async () => { throw new Error('network') })
  assert.ok(failed.includes('—') && !failed.includes('Not available') && !failed.includes('zz9'), `a failure says nothing about access: ${failed}`)
})

test('214a. Upload new is not offered to an actor who may create a file and set none of its fields but the ones the server fills', async () => {
  const host = await render(controlOf({ value: null }), clientOf([]), { collections: { media: { create: true, operations: { create: true }, fields: { id: { create: true }, createdAt: { create: true }, updatedAt: { create: true } } } } } as unknown as ScreenState['access'])
  assert.equal(host.querySelector('[data-upload-new]') === null, true)
})

test('217o. the upload dialog draws its own file button, refuses an empty alternative text under the box it is missing from before sending, and names every locale\'s box', async () => {
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  const client = clientOf(asked)
  const host = await render(controlOf({ value: null, client }), client)
  await act(async () => click(host.querySelector('[data-upload-new]')!))
  await act(async () => sleep(20))
  const dialog = window.document.querySelector('[data-upload-dialog="media"]') as unknown as Element
  const input = dialog.querySelector('input[type="file"]') as unknown as HTMLInputElement
  assert.equal(input.className.includes('sr-only'), true, 'the browser\'s own button is not drawn')
  assert.equal(dialog.querySelector(`label[for="${input.id}"][aria-hidden="true"]`)?.textContent, 'Choose a file', 'the dialog draws its own, in the page\'s words')
  assert.equal(dialog.querySelector('[data-upload-chosen]')?.textContent, 'No file chosen')
  assert.equal(dialog.querySelector('form')?.hasAttribute('novalidate'), true, 'and the browser validates nothing')
  assert.equal(dialog.querySelector('label[for="upload-media-alt-ar"]') !== null, true, 'the Arabic box has a label of its own')
  assert.equal(dialog.textContent?.includes('image/png'), false, 'the accepted types are named, not written as MIME types')
  assert.equal(dialog.textContent?.includes('PNG'), true)

  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' })], configurable: true })
  await act(async () => fire(input as unknown as Element, 'change'))
  assert.equal(dialog.querySelector('[data-upload-chosen]')?.textContent, 'cover.png', 'the chosen file is named beside the button')
  await act(async () => typeInto(dialog.querySelector('#upload-media-alt')!, 'A cover'))
  await act(async () => fire(dialog.querySelector('form')!, 'submit'))
  await act(async () => sleep(20))
  assert.equal(asked.some((one) => one.operation === 'uploadInstructions'), false, 'nothing is sent')
  assert.equal(dialog.querySelector('#upload-media-alt-error')?.textContent, 'media.alt.required', 'the field says it is required, in its own key\'s words')
  assert.equal(dialog.querySelector('#upload-media-alt-ar')?.getAttribute('aria-invalid'), 'true', 'the empty Arabic box is marked')
  assert.equal(dialog.querySelector('#upload-media-alt')?.getAttribute('aria-invalid'), null, 'and the filled English box is not')
  assert.equal(dialog.querySelector('[data-upload-refused]'), null, 'with no banner above the form')
})

test('the unattached upload cap is translated with its limit and cannot be retried unchanged', async () => {
  const { refusalOf } = await import('../registry/upload-api.ts')
  const error = Object.assign(new Error('Attach a file first.'), { data: { key: 'error.invalid.upload_limit', params: { limit: 5 } } })
  assert.deepEqual(refusalOf(error, () => 'أرفق ملفا أو احذفه أولا. الحد {limit}.'), { words: 'أرفق ملفا أو احذفه أولا. الحد 5.', retry: false })
})

// An upload kayan of another name than the template's, so nothing below holds because the kayan is called `media`.
const files = { ...media, name: 'files', pages: { list: { path: '/files' }, create: { path: '/files/new' }, edit: { path: '/files/:id' } } } as unknown as typeof media
const mayCreateFiles = { collections: { files: { create: true, operations: { create: true }, fields: { alt: { create: true } } } } } as unknown as ScreenState['access']
const filesClient = (asked: { operation: string; input: Record<string, unknown> }[]) => clientOf(asked, {
  uploadInstructions: () => ({ type: 'http', request: { method: 'PUT', url: '/api/storage/local/token', headers: {} }, file: { uploadReference: { id: 'n9' } } }),
  create: (input) => ({ ...png, id: 'n9', url: '/api/files/file/n9', thumbnailURL: '/api/files/file/n9', ...input }),
})
/** Chooses a file and fills the alternative text in the open dialog of `kayan`, then sends it. */
const uploadIn = async (kayan: string) => {
  const dialog = window.document.querySelector(`[data-upload-dialog="${kayan}"]`) as unknown as Element
  const input = dialog.querySelector('input[type="file"]') as unknown as HTMLInputElement
  Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1, 2, 3])], 'new.png', { type: 'image/png' })], configurable: true })
  await act(async () => fire(input as unknown as Element, 'change'))
  await act(async () => typeInto(dialog.querySelector(`#upload-${kayan}-alt`)!, 'New'))
  await act(async () => typeInto(dialog.querySelector(`#upload-${kayan}-alt-ar`)!, 'جديد'))
  await act(async () => fire(dialog.querySelector('form')!, 'submit'))
  await act(async () => sleep(20))
}

test('186ag. an upload kayan lists each file by its thumbnail before its name, or its name alone, and its size as a person reads it', async () => {
  const { FileCell, FileSizeCell } = await import('../registry/upload-pages.tsx')
  const filename = files.fields.find((one) => one.name === 'filename')!
  const image = await render(createElement(FileCell, { field: filename, value: 'cover.png', row: { ...png, url: '/api/files/file/a1', thumbnailURL: '/api/files/file/a1' } }))
  assert.equal(image.querySelector('img[data-upload-thumbnail]')?.getAttribute('src'), '/api/files/file/a1', 'the thumbnail through the row\'s own file route')
  assert.equal(image.textContent, 'cover.png', 'before the name')
  assert.equal(image.querySelector('[title="cover.png"]')?.className.includes('min-w-28'), true, 'which keeps room enough to be read on a phone')
  const other = await render(createElement(FileCell, { field: filename, value: 'notes.pdf', row: pdf }))
  assert.equal(other.querySelector('img'), null, 'a file that is no image has no thumbnail')
  assert.equal(other.textContent?.includes('notes.pdf'), true, 'and is named')
  const size = await render(createElement(FileSizeCell, { field: files.fields.find((one) => one.name === 'filesize')!, value: 2048, row: png }))
  assert.equal(size.textContent, '2 kilobytes', 'the size is never the raw bytes')
  const { sizeOf } = await import('../registry/upload-api.ts')
  assert.deepEqual([sizeOf(512, 'en'), sizeOf(1536 * 1024, 'en')], ['512 bytes', '1.5 megabytes'])
  assert.deepEqual([sizeOf(512, 'ar'), sizeOf(1536 * 1024, 'ar')].map((one) => one.replace(/[\d٠-٩٫.]+\s*/, '')), ['بايت', 'ميغابايت'], 'and in Arabic')
})

test('186ah. an upload kayan\'s New page opens the upload dialog at once, opens the new row once it is made, and goes back to the list on Cancel', async (context) => {
  const { NewUpload } = await import('../registry/upload-pages.tsx')
  const went: string[] = []
  context.mock.method(window.location as unknown as Record<'assign', (to: string) => void>, 'assign', (to: string) => void went.push(to))
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  const page = () => render(createElement(NewUpload, { locales: ['ar', 'en'] }), filesClient(asked), mayCreateFiles, { kayan: files })
  await page()
  assert.equal(window.document.querySelector('[data-upload-dialog="files"]') !== null, true, 'the dialog for the page\'s own kayan is open at once')
  await uploadIn('files')
  assert.deepEqual(asked.map((one) => one.operation), ['uploadInstructions', 'create'], 'the file is sent before the row is made')
  assert.deepEqual(asked[1]!.input, { alt: { ar: 'جديد', en: 'New' }, uploadReference: { id: 'n9' } }, 'with its declared fields')
  assert.deepEqual(went, ['/dashboard/files/n9'], 'and the new row opens, and the dialog closing itself is no Cancel')

  went.length = 0
  await page()
  const cancel = [...window.document.querySelectorAll('[data-upload-dialog="files"] button')].find((one) => one.textContent === 'Cancel')
  await act(async () => click(cancel as unknown as Element))
  assert.deepEqual(went, ['/dashboard/files'], 'Cancel goes back to the list')
  assert.equal(window.document.querySelector('[data-upload-new-page] button') !== null, true, 'and the page under the dialog opens it again')
})

test('186ai. an upload kayan\'s edit page leads with the file, its size, Download through the file route, and Replace file, which uploads a new file and opens it, leaving this one', async (context) => {
  const { FileDetails } = await import('../registry/upload-pages.tsx')
  const went: string[] = []
  context.mock.method(window.location as unknown as Record<'assign', (to: string) => void>, 'assign', (to: string) => void went.push(to))
  const asked: { operation: string; input: Record<string, unknown> }[] = []
  const record = { ...png, filesize: 2048, url: '/api/files/file/a1', thumbnailURL: '/api/files/file/a1' }
  const details = (access: ScreenState['access']) => render(createElement(FileDetails, { locales: ['ar', 'en'] }), filesClient(asked), access, { kayan: files, record })
  let host = await details(mayCreateFiles)
  assert.equal(host.querySelector('[data-file-details]')?.hasAttribute('data-lead'), true, 'marked to lead, so the record layout puts it above the form on a phone')
  assert.equal(host.querySelector('img[data-upload-thumbnail]')?.getAttribute('src'), '/api/files/file/a1', 'the file itself')
  assert.equal(host.textContent?.includes('2 kilobytes'), true, 'its size')
  assert.equal(host.querySelector('[data-file-download]')?.getAttribute('download'), 'cover.png', 'Download saves it under its name')
  assert.equal(host.querySelector('[data-file-download]')?.getAttribute('href'), '/api/files/file/a1', 'through the file route')
  await act(async () => click(host.querySelector('[data-file-replace]')!))
  assert.equal(window.document.querySelector('[data-upload-dialog="files"]') !== null, true, 'Replace file opens the upload dialog for this kayan')
  await uploadIn('files')
  assert.deepEqual(asked.map((one) => one.operation), ['uploadInstructions', 'create'], 'it makes a new row, and never updates or deletes this one')
  assert.deepEqual(went, ['/dashboard/files/n9'], 'and opens it')
  host = await details({ collections: { media: { create: true } } } as never)
  assert.equal(host.querySelector('[data-file-replace]'), null, 'not offered to a viewer who may not make a file of this kayan')
  assert.equal(host.querySelector('[data-file-download]') !== null, true, 'who may still download it')
})

test('186aj. the template\'s media draws with the built-ins its dashboard registers, and holds no copies of its own', async () => {
  const { existsSync } = await import('node:fs')
  assert.equal(existsSync(new URL('../../../templates/features/media/media/ui/preview.tsx', import.meta.url)), false, 'the copied pieces are gone')
  const of = (name: string) => screen.components[name]
  assert.deepEqual(['fileCell', 'fileSizeCell', 'fileDetails', 'newUpload'].map((name) => of(name)?.replace(/^.*\//, '')), ['uploads.tsx#FileCell', 'uploads.tsx#FileSizeCell', 'uploads.tsx#FileDetails', 'uploads.tsx#NewUpload'])
  const list = JSON.stringify(media.pages.list)
  assert.equal(list.includes(`"field":"filename","cell":"${of('fileCell')}"`) && list.includes(`"field":"filesize","cell":"${of('fileSizeCell')}"`), true, 'the list draws the file and size cells')
  assert.equal((media.pages.create as { component?: string }).component, of('newUpload'), 'New is the upload page')
  assert.equal(JSON.stringify(media.pages.edit).includes(`"component":"${of('fileDetails')}"`), true, 'and the edit page draws the file beside the form')
  // The template's own page draws the built-in in its shell, with its locales.
  const { NewUpload } = await import('../../../templates/mithaq/src/ui/uploads.tsx')
  await render(createElement(NewUpload, { page: media.pages.create! }), clientOf([]), mayCreate, { kayan: media })
  assert.equal(window.document.querySelector('[data-upload-dialog="media"]') !== null, true, 'the template\'s New page opens the dialog')
  assert.equal(window.document.querySelectorAll('#upload-media-alt, #upload-media-alt-ar').length, 2, 'asking the alternative text in each of its locales')
})
