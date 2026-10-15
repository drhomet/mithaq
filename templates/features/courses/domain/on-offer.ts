// The courses the portal offers: every course not archived, of those a plain
// read answers, which are the published ones. The portal's catalogue, its home
// and its course page read these alone. Plain data in a file of its own, so a
// page reads it without the kayan's declaration. A course with no `archived`
// value is not archived either.
export const onOffer = { or: [{ archived: { exists: false } }, { archived: { equals: false } }] }
