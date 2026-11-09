use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount, Transfer};

declare_id!("WsEscrow11111111111111111111111111111111111");

pub const ESCROW_SEED_PREFIX: &[u8] = b"worksphere_escrow";

#[program]
pub mod worksphere_escrow {
    use super::*;

    /// Initialize escrow and deposit native SOL into the booking vault PDA.
    pub fn deposit_sol(
        ctx: Context<DepositSol>,
        booking_id: String,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(booking_id.len() <= 64, EscrowError::BookingIdTooLong);

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.booking_id = booking_id;
        escrow.depositor = ctx.accounts.depositor.key();
        escrow.recipient = ctx.accounts.recipient.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.amount = amount;
        escrow.currency = Currency::Sol;
        escrow.bump = ctx.bumps.escrow_account;
        escrow.state = EscrowState::Active;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.check_in_verified_at = None;
        escrow.venue_closed_verified_at = None;

        // Transfer SOL from depositor to the escrow account PDA
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.depositor.key(),
            &ctx.accounts.escrow_account.key(),
            amount,
        );
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.escrow_account.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        emit!(DepositEvent {
            booking_id: escrow.booking_id.clone(),
            depositor: escrow.depositor,
            amount,
            currency: Currency::Sol,
        });

        Ok(())
    }

    /// Initialize escrow and deposit USDC (SPL-Token) into the vault token account.
    pub fn deposit_usdc(
        ctx: Context<DepositUsdc>,
        booking_id: String,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(booking_id.len() <= 64, EscrowError::BookingIdTooLong);

        let escrow = &mut ctx.accounts.escrow_account;
        escrow.booking_id = booking_id;
        escrow.depositor = ctx.accounts.depositor.key();
        escrow.recipient = ctx.accounts.recipient.key();
        escrow.authority = ctx.accounts.authority.key();
        escrow.amount = amount;
        escrow.currency = Currency::Usdc;
        escrow.bump = ctx.bumps.escrow_account;
        escrow.state = EscrowState::Active;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.check_in_verified_at = None;
        escrow.venue_closed_verified_at = None;

        // Transfer tokens from depositor token account to vault token account
        let cpi_accounts = Transfer {
            from: ctx.accounts.depositor_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.depositor.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        emit!(DepositEvent {
            booking_id: escrow.booking_id.clone(),
            depositor: escrow.depositor,
            amount,
            currency: Currency::Usdc,
        });

        Ok(())
    }

    /// Release escrowed funds to the venue recipient upon verified check-in.
    /// Must be signed by the trusted WorkSphere platform authority/oracle.
    pub fn release(
        ctx: Context<ReleaseEscrow>,
        booking_id: String,
        check_in_timestamp: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_account;

        require_eq!(escrow.state, EscrowState::Active, EscrowError::EscrowNotActive);
        require!(escrow.booking_id == booking_id, EscrowError::BookingMismatch);
        require!(
            ctx.accounts.authority.key() == escrow.authority,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.recipient.key() == escrow.recipient,
            EscrowError::InvalidRecipient
        );

        escrow.check_in_verified_at = Some(check_in_timestamp);
        escrow.state = EscrowState::Released;

        match escrow.currency {
            Currency::Sol => {
                let amount = escrow.amount;
                **ctx.accounts.escrow_account.to_account_info().try_borrow_mut_lamports()? -= amount;
                **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;
            }
            Currency::Usdc => {
                let seeds = &[
                    ESCROW_SEED_PREFIX,
                    escrow.booking_id.as_bytes(),
                    &[escrow.bump],
                ];
                let signer = &[&seeds[..]];

                let vault_token_account = ctx.accounts.vault_token_account.as_ref()
                    .ok_or(EscrowError::MissingTokenAccount)?;
                let recipient_token_account = ctx.accounts.recipient_token_account.as_ref()
                    .ok_or(EscrowError::MissingTokenAccount)?;
                let token_program = ctx.accounts.token_program.as_ref()
                    .ok_or(EscrowError::MissingTokenProgram)?;

                let cpi_accounts = Transfer {
                    from: vault_token_account.to_account_info(),
                    to: recipient_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_account.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                );
                token::transfer(cpi_ctx, escrow.amount)?;
            }
        }

        emit!(ReleaseEvent {
            booking_id: escrow.booking_id.clone(),
            recipient: escrow.recipient,
            amount: escrow.amount,
            check_in_timestamp,
        });

        Ok(())
    }

    /// Refund escrowed funds to the original depositor upon verified venue closure.
    /// Must be signed by the trusted WorkSphere platform authority/oracle.
    pub fn refund(
        ctx: Context<RefundEscrow>,
        booking_id: String,
        reason: String,
        closure_timestamp: i64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow_account;

        require_eq!(escrow.state, EscrowState::Active, EscrowError::EscrowNotActive);
        require!(escrow.booking_id == booking_id, EscrowError::BookingMismatch);
        require!(
            ctx.accounts.authority.key() == escrow.authority,
            EscrowError::Unauthorized
        );
        require!(
            ctx.accounts.depositor.key() == escrow.depositor,
            EscrowError::InvalidDepositor
        );

        escrow.venue_closed_verified_at = Some(closure_timestamp);
        escrow.state = EscrowState::Refunded;

        match escrow.currency {
            Currency::Sol => {
                let amount = escrow.amount;
                **ctx.accounts.escrow_account.to_account_info().try_borrow_mut_lamports()? -= amount;
                **ctx.accounts.depositor.to_account_info().try_borrow_mut_lamports()? += amount;
            }
            Currency::Usdc => {
                let seeds = &[
                    ESCROW_SEED_PREFIX,
                    escrow.booking_id.as_bytes(),
                    &[escrow.bump],
                ];
                let signer = &[&seeds[..]];

                let vault_token_account = ctx.accounts.vault_token_account.as_ref()
                    .ok_or(EscrowError::MissingTokenAccount)?;
                let depositor_token_account = ctx.accounts.depositor_token_account.as_ref()
                    .ok_or(EscrowError::MissingTokenAccount)?;
                let token_program = ctx.accounts.token_program.as_ref()
                    .ok_or(EscrowError::MissingTokenProgram)?;

                let cpi_accounts = Transfer {
                    from: vault_token_account.to_account_info(),
                    to: depositor_token_account.to_account_info(),
                    authority: ctx.accounts.escrow_account.to_account_info(),
                };
                let cpi_ctx = CpiContext::new_with_signer(
                    token_program.to_account_info(),
                    cpi_accounts,
                    signer,
                );
                token::transfer(cpi_ctx, escrow.amount)?;
            }
        }

        emit!(RefundEvent {
            booking_id: escrow.booking_id.clone(),
            depositor: escrow.depositor,
            amount: escrow.amount,
            reason,
            closure_timestamp,
        });

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Account Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(booking_id: String)]
pub struct DepositSol<'info> {
    #[account(
        init,
        payer = depositor,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [ESCROW_SEED_PREFIX, booking_id.as_bytes()],
        bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    /// CHECK: The venue receiving wallet. Verified during release.
    pub recipient: AccountInfo<'info>,

    /// CHECK: The trusted platform oracle/authority permitted to verify release/refund.
    pub authority: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(booking_id: String)]
pub struct DepositUsdc<'info> {
    #[account(
        init,
        payer = depositor,
        space = 8 + EscrowAccount::INIT_SPACE,
        seeds = [ESCROW_SEED_PREFIX, booking_id.as_bytes()],
        bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(mut)]
    pub depositor_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// CHECK: The venue receiving wallet.
    pub recipient: AccountInfo<'info>,

    /// CHECK: The platform oracle authority.
    pub authority: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(booking_id: String)]
pub struct ReleaseEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED_PREFIX, booking_id.as_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// Platform authority signer confirming verified check-in.
    pub authority: Signer<'info>,

    /// CHECK: Must match escrow_account.recipient.
    #[account(mut)]
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub vault_token_account: Option<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub recipient_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(booking_id: String)]
pub struct RefundEscrow<'info> {
    #[account(
        mut,
        seeds = [ESCROW_SEED_PREFIX, booking_id.as_bytes()],
        bump = escrow_account.bump,
    )]
    pub escrow_account: Account<'info, EscrowAccount>,

    /// Platform authority signer confirming verified venue closure.
    pub authority: Signer<'info>,

    /// CHECK: Must match escrow_account.depositor.
    #[account(mut)]
    pub depositor: AccountInfo<'info>,

    #[account(mut)]
    pub vault_token_account: Option<Account<'info, TokenAccount>>,

    #[account(mut)]
    pub depositor_token_account: Option<Account<'info, TokenAccount>>,

    pub token_program: Option<Program<'info, Token>>,
    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct EscrowAccount {
    #[max_len(64)]
    pub booking_id: String,
    pub depositor: Pubkey,
    pub recipient: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
    pub currency: Currency,
    pub bump: u8,
    pub state: EscrowState,
    pub created_at: i64,
    pub check_in_verified_at: Option<i64>,
    pub venue_closed_verified_at: Option<i64>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Currency {
    Sol = 0,
    Usdc = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EscrowState {
    Active = 0,
    Released = 1,
    Refunded = 2,
}

// ---------------------------------------------------------------------------
// Events & Errors
// ---------------------------------------------------------------------------

#[event]
pub struct DepositEvent {
    pub booking_id: String,
    pub depositor: Pubkey,
    pub amount: u64,
    pub currency: Currency,
}

#[event]
pub struct ReleaseEvent {
    pub booking_id: String,
    pub recipient: Pubkey,
    pub amount: u64,
    pub check_in_timestamp: i64,
}

#[event]
pub struct RefundEvent {
    pub booking_id: String,
    pub depositor: Pubkey,
    pub amount: u64,
    pub reason: String,
    pub closure_timestamp: i64,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero.")]
    InvalidAmount,
    #[msg("Booking ID exceeds maximum length of 64 characters.")]
    BookingIdTooLong,
    #[msg("Escrow account is not in Active state.")]
    EscrowNotActive,
    #[msg("Booking ID does not match escrow record.")]
    BookingMismatch,
    #[msg("Signer is not authorized to release or refund this escrow.")]
    Unauthorized,
    #[msg("Recipient account does not match designated venue wallet.")]
    InvalidRecipient,
    #[msg("Depositor account does not match original payer wallet.")]
    InvalidDepositor,
    #[msg("Token account missing for SPL token escrow operation.")]
    MissingTokenAccount,
    #[msg("Token program missing for SPL token escrow operation.")]
    MissingTokenProgram,
}

