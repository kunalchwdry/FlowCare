# Why there is no `loading.tsx` at `/appointments` or `/appointments/[id]`

(`/appointments/new/loading.tsx` does exist and is fine — see the last
paragraph.)

A `loading.tsx` makes Next.js flush the page shell to the browser immediately
and stream the rest. Once those bytes are sent the HTTP status is fixed at
200, so a later `notFound()` inside `page.tsx` can only swap the *body* — it
can no longer produce a real `404`.

This route reads an appointment, and its ownership check is exactly that
`notFound()`: a patient asking for somebody else's appointment must get a
404, not a 200 carrying a "not found" page. `tests/api.booking.test.ts`
("does not expose one patient's appointment to another") asserts the status
code, and it caught this when a skeleton was briefly added here.

Note that a `loading.tsx` applies to the **whole subtree** beneath it, not
just its own page. Putting one at `app/appointments/loading.tsx` starts the
stream for `/appointments/[id]` as well, which is why neither level has one.

Every other route in the app is free to have a skeleton, including
`/appointments/new`: that page renders a booking form rather than fetching
somebody's record, so it never calls `notFound()` and has nothing to lose by
streaming early. The rule is not "no skeletons here" — it is "no skeleton
above a route whose authorisation check is a status code".
