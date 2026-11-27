//! Stash's on-chain program: the user's stash rule and a receipt for every
//! payment that has been stashed.
//!
//! What lives here, and why on chain:
//! - **The rule** ("stash 20% of every payment: 60% S&P 500, 40% Nvidia") is
//!   an account owned by the user's wallet, not a row in our database. Anyone
//!   can read it; only the owner can change it.
//! - **The stash receipt** is created inside the same atomic transaction as
//!   the Jupiter swaps. If any swap fails, no receipt exists; if a receipt
//!   already exists for a payment, the whole transaction fails. So "a payment
//!   is never stashed twice" is enforced by Solana, not by our server.
//! - **Verified xStocks only.** A rule may name only the five xStock mints
//!   Stash has verified. Look-alike tokens with the same names exist.
//!
//! What it does not do: it does not check the payment itself. The server reads
//! the payment from the chain and passes its amount; the program checks the
//! stashed amount is exactly what the rule says for that amount.

use anchor_lang::prelude::*;

declare_id!("7G66DnGnvPBaAr4hWNhno1ZDeAuh2bvcFmKm5UiZu7oJ");

/// A basket holds at most two stocks. Measured 27 Nov 2026: two Jupiter swaps
/// plus this program's receipt take 1,002 of a transaction's 1,232 bytes;
/// three swaps plus the receipt never fit.
pub const MAX_BASKET_LEGS: usize = 2;
/// 100% in basis points.
pub const FULL_BPS: u16 = 10_000;

/// The xStocks (Token-2022) mints Stash accepts. Same list as
/// `packages/core/src/allowlist.ts`.
pub const VERIFIED_XSTOCKS: [Pubkey; 5] = [
    pubkey!("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"), // SPYx, S&P 500
    pubkey!("Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ"), // QQQx, Nasdaq 100
    pubkey!("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"), // NVDAx, Nvidia
    pubkey!("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"), // TSLAx, Tesla
    pubkey!("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp"), // AAPLx, Apple
];

#[program]
pub mod stash {
    use super::*;

    /// Creates or replaces the owner's stash rule.
    pub fn set_rule(ctx: Context<SetRule>, stash_bps: u16, basket: Vec<BasketWeight>) -> Result<()> {
        validate_rule(stash_bps, &basket)?;
        let rule = &mut ctx.accounts.rule;
        rule.owner = ctx.accounts.owner.key();
        rule.stash_bps = stash_bps;
        rule.basket = basket;
        rule.bump = ctx.bumps.rule;
        rule.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// Records that one payment was stashed. Put in the same transaction as
    /// the swaps, so the receipt exists exactly when the stash happened.
    ///
    /// `payment_id` is the first 32 bytes of the incoming payment's
    /// transaction signature. It seeds the receipt address, so a second
    /// stash of the same payment cannot create its receipt and fails.
    pub fn record_stash(
        ctx: Context<RecordStash>,
        payment_id: [u8; 32],
        payment_usdc: u64,
        stash_usdc: u64,
    ) -> Result<()> {
        let rule = &ctx.accounts.rule;
        require!(stash_usdc == rule_amount(payment_usdc, rule.stash_bps), StashError::AmountBreaksRule);

        let clock = Clock::get()?;
        let receipt = &mut ctx.accounts.receipt;
        receipt.owner = ctx.accounts.owner.key();
        receipt.payment_id = payment_id;
        receipt.stash_usdc = stash_usdc;
        receipt.slot = clock.slot;
        receipt.bump = ctx.bumps.receipt;

        emit!(Stashed {
            owner: receipt.owner,
            payment_id,
            payment_usdc,
            stash_usdc,
            stash_bps: rule.stash_bps,
        });
        Ok(())
    }
}

/// The rule's share of a payment, rounded down. Matches `allocate()` in
/// `packages/core/src/allocation.ts` to the base unit.
pub fn rule_amount(payment_usdc: u64, stash_bps: u16) -> u64 {
    ((payment_usdc as u128 * stash_bps as u128) / FULL_BPS as u128) as u64
}

pub fn validate_rule(stash_bps: u16, basket: &[BasketWeight]) -> Result<()> {
    require!(stash_bps > 0 && stash_bps <= FULL_BPS, StashError::BadStashShare);
    require!(!basket.is_empty() && basket.len() <= MAX_BASKET_LEGS, StashError::BadBasketSize);
    let mut total: u32 = 0;
    for (i, leg) in basket.iter().enumerate() {
        require!(VERIFIED_XSTOCKS.contains(&leg.mint), StashError::UnverifiedStock);
        require!(leg.weight_bps > 0, StashError::ZeroWeight);
        require!(!basket[..i].iter().any(|l| l.mint == leg.mint), StashError::DuplicateStock);
        total += leg.weight_bps as u32;
    }
    require!(total == FULL_BPS as u32, StashError::WeightsNotWhole);
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub struct BasketWeight {
    pub mint: Pubkey,
    /// This stock's share of the stashed amount, in basis points.
    pub weight_bps: u16,
}

/// One per wallet, at PDA ["rule", owner].
#[account]
#[derive(InitSpace)]
pub struct StashRule {
    pub owner: Pubkey,
    /// Share of each payment to stash, in basis points. 2,000 is 20%.
    pub stash_bps: u16,
    #[max_len(2)]
    pub basket: Vec<BasketWeight>,
    pub updated_at: i64,
    pub bump: u8,
}

/// One per stashed payment, at PDA ["stash", owner, payment_id].
#[account]
#[derive(InitSpace)]
pub struct StashReceipt {
    pub owner: Pubkey,
    pub payment_id: [u8; 32],
    pub stash_usdc: u64,
    pub slot: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct SetRule<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + StashRule::INIT_SPACE,
        seeds = [b"rule", owner.key().as_ref()],
        bump,
    )]
    pub rule: Account<'info, StashRule>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(payment_id: [u8; 32])]
pub struct RecordStash<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [b"rule", owner.key().as_ref()], bump = rule.bump, has_one = owner)]
    pub rule: Account<'info, StashRule>,
    #[account(
        init,
        payer = owner,
        space = 8 + StashReceipt::INIT_SPACE,
        seeds = [b"stash", owner.key().as_ref(), payment_id.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, StashReceipt>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct Stashed {
    pub owner: Pubkey,
    pub payment_id: [u8; 32],
    pub payment_usdc: u64,
    pub stash_usdc: u64,
    pub stash_bps: u16,
}

#[error_code]
pub enum StashError {
    #[msg("Choose how much of each payment to stash: more than 0% and at most 100%.")]
    BadStashShare,
    #[msg("A basket holds one or two stocks, so it fits in one transaction.")]
    BadBasketSize,
    #[msg("Only verified xStocks can be stashed into.")]
    UnverifiedStock,
    #[msg("Every stock in the basket needs a share above 0%.")]
    ZeroWeight,
    #[msg("Each stock can appear in the basket only once.")]
    DuplicateStock,
    #[msg("The basket's shares must add up to 100%.")]
    WeightsNotWhole,
    #[msg("The stashed amount is not what the rule says for this payment.")]
    AmountBreaksRule,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leg(mint: Pubkey, weight_bps: u16) -> BasketWeight {
        BasketWeight { mint, weight_bps }
    }

    #[test]
    fn rule_amount_rounds_down_like_the_app() {
        assert_eq!(rule_amount(500_000_000, 2_000), 100_000_000);
        assert_eq!(rule_amount(333, 2_000), 66);
        assert_eq!(rule_amount(u64::MAX, 10_000), u64::MAX);
    }

    #[test]
    fn accepts_a_whole_basket_of_verified_stocks() {
        let b = vec![leg(VERIFIED_XSTOCKS[0], 6_000), leg(VERIFIED_XSTOCKS[2], 4_000)];
        assert!(validate_rule(2_000, &b).is_ok());
    }

    #[test]
    fn refuses_bad_rules() {
        let spy = VERIFIED_XSTOCKS[0];
        let nvda = VERIFIED_XSTOCKS[2];
        assert!(validate_rule(0, &[leg(spy, 10_000)]).is_err());
        assert!(validate_rule(10_001, &[leg(spy, 10_000)]).is_err());
        assert!(validate_rule(2_000, &[]).is_err());
        assert!(validate_rule(2_000, &[leg(spy, 6_000), leg(nvda, 3_000)]).is_err());
        assert!(validate_rule(2_000, &[leg(spy, 5_000), leg(spy, 5_000)]).is_err());
        assert!(validate_rule(2_000, &[leg(Pubkey::new_unique(), 10_000)]).is_err());
        let three = vec![
            leg(VERIFIED_XSTOCKS[0], 4_000),
            leg(VERIFIED_XSTOCKS[1], 3_000),
            leg(VERIFIED_XSTOCKS[2], 3_000),
        ];
        assert!(validate_rule(2_000, &three).is_err());
    }
}
