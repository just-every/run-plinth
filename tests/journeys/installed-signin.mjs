// Bootstrap only a disposable installation through its own private native development entrance.
import assert from 'node:assert/strict'
import {userInfo} from 'node:os'
import {chromium} from '@playwright/test'
assert.equal(process.env.HOME,userInfo().homedir,'Browser-driving Node must use the real account HOME')
const base=process.env.PLINTH_URL,ownerOpen=process.env.PLINTH_OWNER_OPEN
assert.ok(base&&ownerOpen&&new URL(base).origin===new URL(ownerOpen).origin)
const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
try{
 const context=await browser.newContext(),page=await context.newPage()
 await page.goto(ownerOpen);await page.waitForURL(u=>!u.pathname.startsWith('/auth/')&&!u.pathname.startsWith('/__dev/'));await page.goto(base+'/app')
 if(new URL(page.url()).pathname==='/setup'){
  await page.getByLabel('Your name',{exact:true}).fill('Morgan Mason, builder')
  await page.getByRole('checkbox',{name:'I confirm this owner account is ready to use.'}).check()
  await page.getByRole('button',{name:'Finish setup',exact:true}).click();await page.waitForURL('**/app')
 }
 await context.close()
}finally{await browser.close()}
