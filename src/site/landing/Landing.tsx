// The run-site homepage: one job at one remodeler, Job 2214 at Minnehaha
// Design-Build, in the desk's order (page-s1, approved 18 Oct 2026).
import '../styles/site.css'
import '../styles/hero.css'
import '../styles/cards.css'
import '../styles/gantt.css'
import '../styles/sections.css'
import '../styles/scenes.css'
import { Hero } from './Hero'
import { Schedule } from './sections/Schedule'
import { ChangeOrder } from './sections/ChangeOrder'
import { Slip } from './sections/Slip'
import { Billing } from './sections/Billing'
import { Field } from './sections/Field'
import { Subs } from './sections/Subs'
import { Selections } from './sections/Selections'
import { Verified } from './sections/Verified'
import { JobCost } from './sections/JobCost'
import { NextJob } from './sections/NextJob'
import { MapInterlude } from './sections/Map'
import { MovingIn } from './sections/MovingIn'
import { Closing, Footer } from './sections/Closing'

export function Landing() {
  return <>
    <a className="skip" href="#schedule">Skip to content</a>
    <Hero />
    <main>
      <Schedule />
      <ChangeOrder />
      <Slip />
      <Billing />
      <Field />
      <Subs />
      <Selections />
      <Verified />
      <JobCost />
      <NextJob />
      <MapInterlude />
      <MovingIn />
      <Closing />
    </main>
    <Footer />
  </>
}
