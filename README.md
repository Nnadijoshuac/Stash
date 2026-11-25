<a id="top"></a>

<h1 align="center">Stash</h1>

<p align="center">
  <strong>Get paid in dollars. Keep some of it in stocks.</strong><br>
  Set a rule once. Every payment you receive buys your basket, in one transaction, any day of the week.
</p>

<p align="center">
  <a href="#x-running-it">Run it locally</a>
  &nbsp; · &nbsp;
  <a href="#xi-what-is-true-and-what-is-not">What works today</a>
  &nbsp; · &nbsp;
  <a href="https://hack.dev3pack.xyz">Dev3pack Global Hackathon ↗</a>
</p>

<p align="center">
  <sub>SOLANA &nbsp; / &nbsp; TOKEN-2022 xSTOCKS &nbsp; / &nbsp; JUPITER &nbsp; / &nbsp; NEXT.JS</sub>
</p>

---

> **Draft, 25 November 2026.** This README is written before the code, on purpose. It is a design
> document. Nothing below is claimed as working until it appears, with a signature, in
> [What works today](#xi-what-is-true-and-what-is-not).

> **The stock market should be where your money goes by default, not a place you apply to.**
>
> Most people paid in dollars outside the US cannot easily own a share of the S&P 500. The obstacles
> are paperwork, a funding delay measured in days, and a market that closes on Friday afternoon.
> Tokenized equities on Solana remove all three. What is missing is the habit.

| What has been observed on chain | Where the boundary is |
| :--- | :--- |
| Nothing yet. | Every claim below is a plan until it has a signature. |

<details>
<summary><strong>Contents</strong></summary>

| | Chapter | |
| :--- | :--- | :--- |
| 01 | [The gap](#i-the-problem) | Why dollars sit idle |
| 02 | [The promise](#ii-the-one-idea) | One rule, one tap, one transaction |
| 03 | [Architecture](#iii-the-shape) | Where truth lives |
| 04 | [The life of a stash](#iv-the-life-of-a-stash) | Rule, quote, build, sign |
| 05 | [Edge cases](#v-edges) | Who can hold xStocks, and who can freeze them |
| 06 | [Getting out](#vi-getting-out) | Selling back to dollars |
| 07 | [Risk and economics](#vii-risk) | What it costs, and what it earns |
| 08 | [Engineering decisions](#viii-the-decisions) | Written as they happen |
| 09 | [Repository map](#ix-the-map) | Where the moving parts live |
| 10 | [Run locally](#x-running-it) | Steps and troubleshooting |
| 11 | [What works today](#xi-what-is-true-and-what-is-not) | Observed, unobserved, absent |

</details>

---

<a id="i-the-problem"></a>

## 01 · The gap

You just got paid $500 in USDC for a job. You want $100 of it to grow.

The usual options and what is wrong with each:

| Option | What gets in the way |
| :--- | :--- |
| An international brokerage app | Identity checks, funding by bank wire or card, days before the money arrives, and trading only when New York is open |
| Leaving it in USDC | Safe, and it does not grow |
| Buying a token on a DEX by hand | One stock at a time, a different screen for each, and nothing that repeats |

The author's own version: second place at Stocklana paid $20,000 in USDC. Keeping part of it in an
index fund meant choosing between paperwork and doing it by hand every time. Stash is the version
that does it automatically.

<a id="ii-the-one-idea"></a>

## 02 · The promise

**Set a rule once. Each payment you receive buys your basket in one transaction.**

- **A rule, not a trade.** "20% of everything I receive: 60% S&P 500, 40% Nvidia." You decide once.
- **One tap per payment.** The whole basket fills in one transaction or not at all. You never end up holding half a basket.
- **Any day, any size.** xStocks trade 24/7, and a $5 purchase costs a fraction of a cent in fees.

<a id="iii-the-shape"></a>

## 03 · Architecture

_To be written as the code exists. Planned shape: a monorepo with `packages/core` (allocation,
quoting, transaction building), `apps/web` (rule, stash and portfolio screens) and `packages/scripts`
(e2e runs against mainnet)._

<a id="iv-the-life-of-a-stash"></a>

## 04 · The life of a stash

| Stage | What happens |
| :--- | :--- |
| Rule | The user picks a percentage and a basket. Stored per wallet. |
| Detect | A USDC payment arrives in the wallet. |
| Quote | The server quotes each leg through Jupiter. The client never names a price. |
| Build | All legs go into one transaction, using a lookup table to fit 1,232 bytes. |
| Sign | The user confirms once. |
| Land | Either every stock in the basket arrives, or nothing moves. |

_Day-1 check: whether two or more Jupiter routes fit in one transaction. If they do not, Stash sends
one transaction per stock, and this chapter will say so._

<a id="v-edges"></a>

## 05 · Edge cases

- **Who can hold xStocks.** Not everyone. Kraken's
  [xStocks FAQ](https://support.kraken.com/articles/xstocks-faq) says they are not accessible in
  the US or to US persons, Canada, the UK or Australia, and holding them in a self-custody wallet
  does not change that. Stash asks you to confirm before your first stash, not after.
- **xStocks are not Solana-only.** They are also issued on Ethereum, TON and Ink. What Stash
  depends on Solana for is narrower and measurable: a whole basket, routed by Jupiter, filled in one
  atomic transaction for a fraction of a cent, on a Sunday as easily as a Tuesday.
- **Who can freeze.** xStocks are Token-2022 mints with an issuer authority. The value read off the mint will be quoted here, as Draw did.
- **A tokenized share is a claim on a share.** It is not the share itself.

<a id="vi-getting-out"></a>

## 06 · Getting out

_Planned: selling a position back to USDC from the portfolio screen._

<a id="vii-risk"></a>

## 07 · Risk and economics

_Planned: the platform fee per swap, network and priority fees per stash, and the break-even stash
size, written down even if small stashes lose money._

<a id="viii-the-decisions"></a>

## 08 · Engineering decisions

_Written as they happen, each with the real error message and the fix._

<a id="ix-the-map"></a>

## 09 · Repository map

_After the first build._

### Built before vs during the hackathon

Stash reuses patterns from [Draw](https://github.com/Nnadijoshuac/draw), the author's own earlier
Solana project (Stocklana, September 2026). Everything copied or adapted from it will be listed here
file by file. Everything else was written between 25 and 29 November 2026.

<a id="x-running-it"></a>

## 10 · Run locally

_After the first build._

<a id="xi-what-is-true-and-what-is-not"></a>

## 11 · What works today

**Observed on chain**

_Nothing yet._

**Built, not observed end to end**

_Nothing yet._

**Deliberately absent**

- A fiat on-ramp or off-ramp. Stash starts from USDC already in the wallet.
- Investment advice. The user chooses the basket.

**Open work**

- Day-1 checks: Jupiter routes and platform fee, multi-route transaction size, holder restrictions.

---

<p align="center">
  <strong>Get paid. Keep some.</strong><br>
  <sub>Built for the <a href="https://hack.dev3pack.xyz">Dev3pack Global Hackathon ↗</a></sub>
</p>
