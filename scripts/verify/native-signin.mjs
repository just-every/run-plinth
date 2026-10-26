import assert from 'node:assert/strict'

// Read only the synthetic provider inbox, then use the built Worker's own form.
export async function nativeSignIn(page, email) {
 const control = process.env.PLINTH_PROVIDER_EDGE_URL
 assert.ok(control && new URL(control).hostname === '127.0.0.1', 'Synthetic provider inbox required')
 const response = await page.context().request.post(control + '/auth/link', { data: { email } })
 assert.equal(response.status(), 200, 'Native authentication email reached the provider boundary')
 const { url } = await response.json()
 assert.equal(new URL(url).origin, process.env.PLINTH_URL)
 try {
  await page.goto(url)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await page.waitForURL(value => !value.pathname.startsWith('/auth/'))
 } catch { throw new Error('Native email confirmation did not complete; private link withheld') }
}
