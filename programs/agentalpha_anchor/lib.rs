use anchor_lang::prelude::*;
use sha2::{Sha256, Digest};

declare_id!("2dAju7NnKZiA7AmBBd2ciU1FWqD7fgMmQGjAKo5ZPKQA");

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
        provider.total_return_bps = 0; // basis points
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

    /// Update provider info
    pub fn update_provider(
        ctx: Context<UpdateProvider>,
        name: Option<String>,
        endpoint: Option<String>,
        price_lamports: Option<u64>,
    ) -> Result<()> {
        let provider = &mut ctx.accounts.provider;
        let clock = Clock::get()?;
        
        if let Some(n) = name {
            require!(n.len() <= 64, AgentAlphaError::NameTooLong);
            provider.name = n;
        }
        if let Some(e) = endpoint {
            require!(e.len() <= 256, AgentAlphaError::EndpointTooLong);
            provider.endpoint = e;
        }
        if let Some(p) = price_lamports {
            provider.price_lamports = p;
        }
        
        provider.updated_at = clock.unix_timestamp;
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

    /// Reveal a signal (provide data matching the hash)
    pub fn reveal_signal(
        ctx: Context<RevealSignal>,
        token: String,
        direction: u8, // 0=BUY, 1=SELL, 2=HOLD
        confidence: u8, // 0-100
        price_at_signal: u64,
    ) -> Result<()> {
        let commit = &mut ctx.accounts.signal_commit;
        let clock = Clock::get()?;
        
        require!(!commit.revealed, AgentAlphaError::AlreadyRevealed);
        
        // Verify hash matches the revealed data
        let data_to_hash = format!(
            "{}:{}:{}:{}",
            token, direction, confidence, commit.committed_at
        );
        let mut hasher = Sha256::new();
        hasher.update(data_to_hash.as_bytes());
        let computed_hash: [u8; 32] = hasher.finalize().into();
        require!(
            computed_hash == commit.signal_hash,
            AgentAlphaError::HashMismatch
        );
        
        commit.revealed = true;
        commit.token = token;
        commit.direction = direction;
        commit.confidence = confidence;
        commit.price_at_signal = price_at_signal;
        commit.revealed_at = clock.unix_timestamp;
        
        emit!(SignalRevealed {
            provider: commit.provider,
            signal_hash: commit.signal_hash,
            token: commit.token.clone(),
            direction: commit.direction,
            confidence: commit.confidence,
        });
        
        Ok(())
    }

    /// Record signal outcome (called by oracle/indexer)
    pub fn record_outcome(
        ctx: Context<RecordOutcome>,
        price_at_evaluation: u64,
        was_correct: bool,
        return_bps: i32, // basis points, can be negative
    ) -> Result<()> {
        let commit = &mut ctx.accounts.signal_commit;
        let provider = &mut ctx.accounts.provider;
        let clock = Clock::get()?;
        
        require!(commit.revealed, AgentAlphaError::NotRevealed);
        require!(!commit.outcome_recorded, AgentAlphaError::OutcomeAlreadyRecorded);
        
        commit.outcome_recorded = true;
        commit.price_at_evaluation = price_at_evaluation;
        commit.was_correct = was_correct;
        commit.return_bps = return_bps;
        commit.evaluated_at = clock.unix_timestamp;
        
        // Update provider reputation
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
            total_signals: provider.total_signals,
            correct_signals: provider.correct_signals,
        });
        
        Ok(())
    }
}

// ==================== ACCOUNTS ====================

#[derive(Accounts)]
#[instruction(name: String)]
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
pub struct UpdateProvider<'info> {
    #[account(
        mut,
        seeds = [b"provider", authority.key().as_ref()],
        bump = provider.bump,
        has_one = authority
    )]
    pub provider: Account<'info, Provider>,
    
    pub authority: Signer<'info>,
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
pub struct RevealSignal<'info> {
    #[account(
        mut,
        seeds = [b"signal", provider.key().as_ref(), &signal_commit.signal_hash],
        bump = signal_commit.bump
    )]
    pub signal_commit: Account<'info, SignalCommit>,
    
    #[account(
        seeds = [b"provider", authority.key().as_ref()],
        bump = provider.bump,
        has_one = authority
    )]
    pub provider: Account<'info, Provider>,
    
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordOutcome<'info> {
    #[account(
        mut,
        seeds = [b"signal", provider.key().as_ref(), &signal_commit.signal_hash],
        bump = signal_commit.bump
    )]
    pub signal_commit: Account<'info, SignalCommit>,
    
    #[account(
        mut,
        constraint = signal_commit.provider == provider.key()
    )]
    pub provider: Account<'info, Provider>,
    
    /// Oracle authority - in production, this would be a trusted oracle
    pub oracle: Signer<'info>,
}

// ==================== STATE ====================

#[account]
pub struct Provider {
    pub authority: Pubkey,        // 32
    pub name: String,             // 4 + 64
    pub endpoint: String,         // 4 + 256
    pub categories: Vec<u8>,      // 4 + 8
    pub price_lamports: u64,      // 8
    pub total_signals: u64,       // 8
    pub correct_signals: u64,     // 8
    pub total_return_bps: i64,    // 8 (cumulative return in basis points)
    pub created_at: i64,          // 8
    pub updated_at: i64,          // 8
    pub bump: u8,                 // 1
}

impl Provider {
    pub const SIZE: usize = 8 + 32 + (4 + 64) + (4 + 256) + (4 + 8) + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 64; // + padding
    
    pub fn hit_rate_bps(&self) -> u64 {
        if self.total_signals == 0 {
            return 0;
        }
        (self.correct_signals * 10000) / self.total_signals
    }
    
    pub fn avg_return_bps(&self) -> i64 {
        if self.total_signals == 0 {
            return 0;
        }
        self.total_return_bps / self.total_signals as i64
    }
}

#[account]
pub struct SignalCommit {
    pub provider: Pubkey,           // 32
    pub signal_hash: [u8; 32],      // 32
    pub committed_at: i64,          // 8
    pub revealed: bool,             // 1
    pub outcome_recorded: bool,     // 1
    // Revealed data
    pub token: String,              // 4 + 16
    pub direction: u8,              // 1
    pub confidence: u8,             // 1
    pub price_at_signal: u64,       // 8
    pub revealed_at: i64,           // 8
    // Outcome data
    pub price_at_evaluation: u64,   // 8
    pub was_correct: bool,          // 1
    pub return_bps: i32,            // 4
    pub evaluated_at: i64,          // 8
    pub bump: u8,                   // 1
}

impl SignalCommit {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 1 + 1 + (4 + 16) + 1 + 1 + 8 + 8 + 8 + 1 + 4 + 8 + 1 + 64; // + padding
}

// ==================== EVENTS ====================

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
pub struct SignalRevealed {
    pub provider: Pubkey,
    pub signal_hash: [u8; 32],
    pub token: String,
    pub direction: u8,
    pub confidence: u8,
}

#[event]
pub struct OutcomeRecorded {
    pub provider: Pubkey,
    pub signal_hash: [u8; 32],
    pub was_correct: bool,
    pub return_bps: i32,
    pub total_signals: u64,
    pub correct_signals: u64,
}

// ==================== ERRORS ====================

#[error_code]
pub enum AgentAlphaError {
    #[msg("Provider name too long (max 64 chars)")]
    NameTooLong,
    #[msg("Endpoint URL too long (max 256 chars)")]
    EndpointTooLong,
    #[msg("Too many categories (max 8)")]
    TooManyCategories,
    #[msg("Signal already revealed")]
    AlreadyRevealed,
    #[msg("Signal not revealed yet")]
    NotRevealed,
    #[msg("Hash mismatch - revealed data doesn't match commit")]
    HashMismatch,
    #[msg("Outcome already recorded for this signal")]
    OutcomeAlreadyRecorded,
}
