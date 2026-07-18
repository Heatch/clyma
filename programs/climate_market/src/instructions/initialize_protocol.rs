
use anchor_lang::prelude::*;

use crate::constants::PROTOCOL_SEED;
use crate::errors::ClimateMarketError;
use crate::events::ProtocolInitialized;
use crate::state::ProtocolConfig;

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::SPACE,
        seeds = [PROTOCOL_SEED],
        bump
    )]
    pub protocol: Account<'info, ProtocolConfig>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        address = crate::ID,
        constraint = program.programdata_address()? == Some(program_data.key())
            @ ClimateMarketError::UnauthorizedAuthority
    )]
    pub program: Program<'info, crate::program::ClimateMarket>,
    #[account(
        constraint = program_data.upgrade_authority_address == Some(authority.key())
            @ ClimateMarketError::UnauthorizedAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializeProtocol>, resolver: Pubkey) -> Result<()> {
    require!(
        resolver != Pubkey::default(),
        ClimateMarketError::InvalidResolver
    );

    let protocol = &mut ctx.accounts.protocol;
    protocol.authority = ctx.accounts.authority.key();
    protocol.resolver = resolver;
    protocol.market_count = 0;
    protocol.bump = ctx.bumps.protocol;

    emit!(ProtocolInitialized {
        protocol: protocol.key(),
        authority: protocol.authority,
        resolver,
    });
    Ok(())
}
