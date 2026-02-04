use anchor_lang::prelude::*;

declare_id!("AgentA1phaSigna1Marketp1ace11111111111111111");

#[program]
pub mod agentalpha {
    use super::*;

    /// Register a new signal provider
    pub fn register_provider(
        ctx: Context<RegisterProvider>,
        name: String,
        endpoint: String,
        categories: Vec<u8>,
        price_lamports: u64,
    ) -> Result<()> {
        let provider = &mut ctx.accounts.provider;
        let clock = Clock::get()?;
        
        require!(name.len() <= 64, AgentAlphaError::NameTooLong);
        require!(endpoint.len() <= 256, AgentAlphaError::EndpointTooLong);
        require!(categories.len() <= 8, AgentAlphaError::TooManyCategories);
        
        provider.authority = ctx.accounts.authority.key();
        provider.name = name;
        provider.endpoint = endpoint;
        provider.categories = categories;
        provider.price_lamports = price_lamports;
        provider.total_signals = 0;
        provider.correct_signals = 0;
        provider.total_return_bps = 0;
        provider.created_at = clock.unix_timestamp;
        provider.updated_at = clock.unix_timestamp;
        provider.bump = ctx.bumps.provider;
        
        emit!(ProviderRegistered {
            provider: provider.key(),
            authority: provider.authority,
            name: provider.name.clone(),
            endpoint: provider.endpoint.clone(),
        });
        
        Ok(())
    }

    /// Commit a signal (store hash before revealing)
    pub fn commit_signal(
        ctx: Context<CommitSignal>,
        signal_hash: [u8; 32],
    ) -> Result<()> {
        let commit = &mut ctx.accounts.signal_commit;
        let clock = Clock::get()?;
        
        commit.provider = ctx.accounts.provider.key();
        commit.signal_hash = signal_hash;
        commit.committed_at = clock.unix_timestamp;
        commit.revealed = false;
        commit.outcome_recorded = false;
        commit.bump = ctx.bumps.signal_commit;
        
        emit!(SignalCommitted {
            provider: commit.provider,
            signal_hash,
            committed_at: commit.committed_at,
        });
        
        Ok(())
    }

    /// Record signal outcome (called by oracle)
    pub fn record_outcome(
        ctx: Context<RecordOutcome>,
        was_correct: bool,
        return_bps: i32,
    ) -> Result<()> {
        let commit = &mut ctx.accounts.signal_commit;
        let provider = &mut ctx.accounts.provider;
        let clock = Clock::get()?;
        
        require!(!commit.outcome_recorded, AgentAlphaError::OutcomeAlreadyRecorded);
        
        commit.outcome_recorded = true;
        commit.was_correct = was_correct;
        commit.return_bps = return_bps;
        commit.evaluated_at = clock.unix_timestamp;
        
        provider.total_signals += 1;
        if was_correct {
            provider.correct_signals += 1;
        }
        provider.total_return_bps += return_bps as i64;
        provider.updated_at = clock.unix_timestamp;
        
        emit!(OutcomeRecorded {
            provider: provider.key(),
            signal_hash: commit.signal_hash,
            was_correct,
            return_bps,
            hit_rate_bps: provider.hit_rate_bps(),
        });
        
        Ok(())
    }
}

#[derive(Accounts)]
pub struct RegisterProvider<'info> {
    #[account(
        init,
        payer = authority,
        space = Provider::SIZE,
        seeds = [b"provider", authority.key().as_ref()],
        bump
    )]
    pub provider: Account<'info, Provider>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(signal_hash: [u8; 32])]
pub struct CommitSignal<'info> {
    #[account(
        init,
        payer = authority,
        space = SignalCommit::SIZE,
        seeds = [b"signal", provider.key().as_ref(), &signal_hash],
        bump
    )]
    pub signal_commit: Account<'info, SignalCommit>,
    #[account(
        seeds = [b"provider", authority.key().as_ref()],
        bump = provider.bump,
        has_one = authority
    )]
    pub provider: Account<'info, Provider>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordOutcome<'info> {
    #[account(
        mut,
        seeds = [b"signal", provider.key().as_ref(), &signal_commit.signal_hash],
        bump = signal_commit.bump
    )]
    pub signal_commit: Account<'info, SignalCommit>,
    #[account(mut)]
    pub provider: Account<'info, Provider>,
    pub oracle: Signer<'info>,
}

#[account]
pub struct Provider {
    pub authority: Pubkey,
    pub name: String,
    pub endpoint: String,
    pub categories: Vec<u8>,
    pub price_lamports: u64,
    pub total_signals: u64,
    pub correct_signals: u64,
    pub total_return_bps: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

impl Provider {
    pub const SIZE: usize = 8 + 32 + (4 + 64) + (4 + 256) + (4 + 8) + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 64;
    
    pub fn hit_rate_bps(&self) -> u64 {
        if self.total_signals == 0 { return 0; }
        (self.correct_signals * 10000) / self.total_signals
    }
}

#[account]
pub struct SignalCommit {
    pub provider: Pubkey,
    pub signal_hash: [u8; 32],
    pub committed_at: i64,
    pub revealed: bool,
    pub outcome_recorded: bool,
    pub was_correct: bool,
    pub return_bps: i32,
    pub evaluated_at: i64,
    pub bump: u8,
}

impl SignalCommit {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1 + 1 + 1 + 4 + 8 + 1 + 32;
}

#[event]
pub struct ProviderRegistered {
    pub provider: Pubkey,
    pub authority: Pubkey,
    pub name: String,
    pub endpoint: String,
}

#[event]
pub struct SignalCommitted {
    pub provider: Pubkey,
    pub signal_hash: [u8; 32],
    pub committed_at: i64,
}

#[event]
pub struct OutcomeRecorded {
    pub provider: Pubkey,
    pub signal_hash: [u8; 32],
    pub was_correct: bool,
    pub return_bps: i32,
    pub hit_rate_bps: u64,
}

#[error_code]
pub enum AgentAlphaError {
    #[msg("Name too long (max 64)")]
    NameTooLong,
    #[msg("Endpoint too long (max 256)")]
    EndpointTooLong,
    #[msg("Too many categories (max 8)")]
    TooManyCategories,
    #[msg("Outcome already recorded")]
    OutcomeAlreadyRecorded,
}
