import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {test} from 'node:test'
import {base,defaultAuthorize,defaultBulkLimit,defaultDepth,defaultFields,defaultJoinLimit,defaultLimit,defaultMaxBodyBytes,defaultMaxLimit,defaultOperations,defineMithaq,fetchHttp,serviceTarget,zodIdKinds,zodKinds,zodRules,zodTarget,type FieldAccess,type Store} from 'mithaq'
import {memoryStore} from './memory-store.ts'

const fixture = async ({ count = true, linkRead, relatedRead, total }: { count?: boolean; linkRead?: FieldAccess; relatedRead?: FieldAccess; total?: number } = {}) => {
  const memory = memoryStore()
  const reads: Parameters<Store['find']>[0][] = []
  const totals: Parameters<NonNullable<Store['count']>>[0][] = []
  const store = { ...memory,
    find: async (args: Parameters<Store['find']>[0]) => {
      reads.push(args)
      const found = await memory.find(args)
      return args.kayan === 'children' && total !== undefined ? { ...found, totalDocs: total } : found
    },
    count: count ? async (args: Parameters<NonNullable<Store['count']>>[0]) => (totals.push(args), memory.count(args)) : undefined,
  }
  const {defineKayan,buildAsas}=defineMithaq({ arkan:[base], targets:{ store, zod:zodTarget({kinds:zodKinds,rules:zodRules,idKinds:zodIdKinds}), service:serviceTarget({depth:defaultDepth,defaultLimit,maxLimit:defaultMaxLimit,joinLimit:defaultJoinLimit,bulkLimit:defaultBulkLimit,store:'store',schema:'zod',authorize:defaultAuthorize}) } })
  const parents=defineKayan({name:'parents',fields:{...defaultFields,links:{kind:'relationship',relationTo:'children',hasMany:true},children:{kind:'join',relationTo:'children',on:'parent'}},access:{create:()=>true,read:()=>true},targets:{service:{operations:defaultOperations}}})
  const children=defineKayan({name:'children',fields:{...defaultFields,parent:{kind:'relationship',relationTo:'parents',...(linkRead&&{access:{read:linkRead}})},payload:{kind:'text'}},access:{create:()=>true,read:relatedRead??(()=>true)},targets:{service:{operations:defaultOperations}}})
  const built=buildAsas({http:[fetchHttp({maxBodyBytes:defaultMaxBodyBytes,onError:()=>{}})],kayan:[parents,children]})
  const parent=await built.kayan.parents.operations.create({links:[]})
  const child=await built.kayan.children.operations.create({parent:parent.id,payload:'This field must not be loaded for a count.'})
  const seed = async (size: number) => {
    const ids=[child.id]
    for(let index=1;index<size;index++){const id=randomUUID();ids.push(id);await memory.insert({tx:undefined,kayan:'children',data:{...child,id}})}
    await memory.update({tx:undefined,kayan:'parents',id:parent.id,data:{links:ids}})
    reads.length=0;totals.length=0
    return ids
  }
  return {built,memory,parent,child,reads,totals,seed}
}

test('count cells handle more than one thousand linked ids without loading child records', async () => {
  const {built,parent,reads,totals,seed}=await fixture()
  await seed(1501)
  const page=await built.kayan.parents.operations.find({counts:['links','children']})
  assert.deepEqual(page.counts,{links:{[parent.id]:1501},children:{[parent.id]:1501}})
  assert.equal(reads.filter(read=>read.kayan==='children').length,0)
  assert.ok(totals.length>0)
})

test('stores without count project only links in bounded pages', async () => {
  const {built,parent,reads,seed}=await fixture({count:false})
  await seed(1501)
  const page=await built.kayan.parents.operations.find({counts:['links','children']})
  assert.deepEqual(page.counts,{links:{[parent.id]:1501},children:{[parent.id]:1501}})
  const projected=reads.filter(read=>read.kayan==='children')
  assert.ok(projected.length>2)
  for(const read of projected){assert.ok(read.args.limit>0&&read.args.limit<=100);assert.deepEqual(read.args.select,read.args.where&&JSON.stringify(read.args.where).includes('parent')?['parent']:['id'])}
})

test('the projected count ceiling leaves the value unavailable rather than truncating it', async () => {
  const {built,parent,reads}=await fixture({count:false,total:10001})
  reads.length=0
  const page=await built.kayan.parents.operations.find({counts:['children']})
  assert.deepEqual(page.counts,{})
  assert.equal(page.docs[0]?.id,parent.id)
  assert.equal(reads.filter(read=>read.kayan==='children').length,1)
})
