// Minimal per-task USDC escrow for the agent-native freelancer marketplace.
//
// Three instructions:
//   create_escrow    Funds a PDA-owned token account with the bounty.
//   release_to_worker  PDA signs a transfer to the worker's USDC account.
//   refund_to_agent    PDA signs a transfer back to the agent's USDC account.
//
// The authority that may release or refund is captured at create time. In v1
// the backend's platform keypair is the authority for all escrows. This is a
// documented limitation; v2 should make the agent the on-chain authority.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("CZD9e8HA3nuirtb1AgQ7wv4nFYgELjnhAS7PXwDzmZCC");

#[program]
pub mod marketplace_escrow {
    use super::*;

    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        task_nonce: [u8; 32],
        bounty: u64,
    ) -> Result<()> {
        require!(bounty > 0, EscrowError::ZeroBounty);

        let escrow = &mut ctx.accounts.escrow_state;
        escrow.agent = ctx.accounts.agent.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.bounty = bounty;
        escrow.task_nonce = task_nonce;
        escrow.status = EscrowStatus::Funded as u8;
        escrow.bump = ctx.bumps.escrow_state;

        // Pull the bounty from the agent's token account into the PDA-owned vault.
        let cpi_accounts = Transfer {
            from: ctx.accounts.agent_token_account.to_account_info(),
            to: ctx.accounts.escrow_token_account.to_account_info(),
            authority: ctx.accounts.agent.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, bounty)?;

        Ok(())
    }

    pub fn release_to_worker(ctx: Context<ReleaseToWorker>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require!(
            escrow.status == EscrowStatus::Funded as u8,
            EscrowError::WrongStatus
        );
        require_keys_eq!(escrow.authority, ctx.accounts.authority.key(), EscrowError::Unauthorized);

        let task_nonce = escrow.task_nonce;
        let bump = escrow.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", task_nonce.as_ref(), &[bump]]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.worker_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.bounty)?;

        escrow.status = EscrowStatus::Released as u8;
        Ok(())
    }

    pub fn refund_to_agent(ctx: Context<RefundToAgent>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_state;
        require!(
            escrow.status == EscrowStatus::Funded as u8,
            EscrowError::WrongStatus
        );
        require_keys_eq!(escrow.authority, ctx.accounts.authority.key(), EscrowError::Unauthorized);
        require_keys_eq!(escrow.agent, ctx.accounts.agent_token_account.owner, EscrowError::Unauthorized);

        let task_nonce = escrow.task_nonce;
        let bump = escrow.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"escrow", task_nonce.as_ref(), &[bump]]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_token_account.to_account_info(),
            to: ctx.accounts.agent_token_account.to_account_info(),
            authority: escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, escrow.bounty)?;

        escrow.status = EscrowStatus::Refunded as u8;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(task_nonce: [u8; 32], bounty: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub agent: Signer<'info>,

    /// The off-chain authority allowed to release or refund. In v1, the
    /// backend platform keypair. Captured into escrow state on init.
    /// CHECK: just stored, never deserialized as anything specific.
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = agent,
        space = EscrowState::LEN,
        seeds = [b"escrow", task_nonce.as_ref()],
        bump
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        init,
        payer = agent,
        token::mint = mint,
        token::authority = escrow_state,
        seeds = [b"vault", task_nonce.as_ref()],
        bump
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::authority = agent)]
    pub agent_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, Mint>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ReleaseToWorker<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_state.task_nonce.as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        mut,
        seeds = [b"vault", escrow_state.task_nonce.as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = escrow_state.mint)]
    pub worker_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundToAgent<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"escrow", escrow_state.task_nonce.as_ref()],
        bump = escrow_state.bump,
    )]
    pub escrow_state: Account<'info, EscrowState>,

    #[account(
        mut,
        seeds = [b"vault", escrow_state.task_nonce.as_ref()],
        bump,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(mut, token::mint = escrow_state.mint)]
    pub agent_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[account]
pub struct EscrowState {
    pub agent: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bounty: u64,
    pub task_nonce: [u8; 32],
    pub status: u8,
    pub bump: u8,
}

impl EscrowState {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 32 + 1 + 1;
}

#[repr(u8)]
pub enum EscrowStatus {
    Funded = 0,
    Released = 1,
    Refunded = 2,
}

#[error_code]
pub enum EscrowError {
    #[msg("Bounty must be greater than zero.")]
    ZeroBounty,
    #[msg("Escrow is not in the required status for this action.")]
    WrongStatus,
    #[msg("Caller is not the authority for this escrow.")]
    Unauthorized,
}
