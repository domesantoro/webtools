# Todo

## Mocks to dismantle

- **The fake purchase of turns** (opened on 2026-09-24). `POST /analysis/{id}/turns/buy` in the
  preanalyst makes nobody buy anything: it gives 10 turns to the user's credit
  (`FAKE_PURCHASE_TURNS` in `src/server.js`), with nobody paying. It is only there to make it
  possible to try the round of the exhausted turns from beginning to end. When the real payment is
  there, the route and the constant go away together, and the payment engine goes in their place.
- **The analysis chat's answer** (opened on 2026-09-24). `POST /analysis/{id}/messages` counts the
  turn, writes the conversation on the project and takes the credit down for real, but the answer
  is picked at random from `preanalyst.analysis.mock.replies.*` in the catalogues. When the model
  is there, the `mock.*` keys and `mockReplies()` in `src/page.js` go away together.

- **A configuration backoffice**: it must be able to change `webtools/configurator/bootstrap.env`
  too.

## Promises of the "Lavora con noi" page (2026-09-22)

Things the page describes and the system does not have yet:

- **Registration as a driver**, with the application to be enabled and the **interview**; whoever
  passes it goes to `enabled: true` in `drivers`.
- **The driver area**: generating the ambassador links (`?ambassador=`, every driver), the personal
  links (`?driver=`) and the discount codes (`discounts`) for the enabled drivers.
- **The driver's tokens**: the balance, topping it up, the charge at every step (pre-analysis,
  analysis, development) of the autonomous works, an email when they are not enough, blocking and
  unblocking the pipelines.
- **Deleting the code** of an autonomous work from our system, at the driver's request.
- **The costs and revenues calculator**: the driver's share, the system fee, 50% of the fee to the
  ambassador (`billing.ambassador_uid`) on the projects that went through.
