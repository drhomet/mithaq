// The courses the portal offers: every course not archived. The portal lists
// these alone, as its screen's `baseFilter` for the kayan, and its home counts
// these alone. Plain data in a file of its own, so the page that counts reads it
// without the kayan's declaration. A course with no `archived` value is not
// archived either.
export const onOffer = { or: [{ archived: { exists: false } }, { archived: { equals: false } }] }
