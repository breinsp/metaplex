import { Button, Layout } from 'antd';
import React, { useState } from 'react';
import { AuctionView, AuctionViewState, useAuctions, useUserArts } from '../../hooks';
import { settle } from '../../actions/settle';
import {
  Bid,
  BidderMetadata,
  BidderPot,
  cache,
  getBidderPotKey,
  ParsedAccount,
  programIds,
  StringPublicKey,
  toPublicKey,
  useConnection,
  useMeta,
  useUserAccounts,
} from '@oyster/common';
import { useWallet } from '@solana/wallet-adapter-react';

export const BeroView = () => {
  const connection = useConnection();
  const auctionsNeedingSettling = [...useAuctions(AuctionViewState.Ended), ...useAuctions(AuctionViewState.BuyNow)];
  const wallet = useWallet();
  const { accountByMint } = useUserAccounts();
  const { metadata, bidderMetadataByAuctionAndBidder } = useMeta();
  const [pots, setPots] = useState<Record<string, ParsedAccount<BidderPot>>>({});

  function getWinnerPotsByBidderKey(
    auctionView: AuctionView,
  ): Record<string, ParsedAccount<BidderPot>> {
    setPots({});
    const PROGRAM_IDS = programIds();

    const winnersLength = auctionView.auctionManager.numWinners.toNumber();
    const auction = auctionView.auction;
    const winners = auction.info.bidState.bids;
    const truWinners = [...winners].reverse().slice(0, winnersLength);

    (async () => {
      const promises: Promise<{ winner: Bid; key: StringPublicKey }>[] =
        truWinners.map(winner =>
          getBidderPotKey({
            auctionProgramId: PROGRAM_IDS.auction,
            auctionKey: auction.pubkey,
            bidderPubkey: winner.key,
          }).then(key => ({
            key,
            winner,
          })),
        );
      const values = await Promise.all(promises);

      const newPots = values.reduce((agg, value) => {
        const el = cache.get(value.key) as ParsedAccount<BidderPot>;
        if (el) {
          agg[value.winner.key] = el;
        }

        return agg;
      }, {} as Record<string, ParsedAccount<BidderPot>>);

      setPots(newPots);
    })();
    return pots;
  }

  const settleEscrow = async (auctionView) => {
    const winnerPotsByBidderKey = getWinnerPotsByBidderKey(auctionView);

    const auctionKey = auctionView.auction.pubkey;

    const winnersThatCanBeEmptied = Object.values(winnerPotsByBidderKey).filter(
      p => !p.info.emptied,
    );

    const bidsToClaim: {
      metadata: ParsedAccount<BidderMetadata>;
      pot: ParsedAccount<BidderPot>;
    }[] = [
      ...winnersThatCanBeEmptied.map(pot => ({
        metadata:
          bidderMetadataByAuctionAndBidder[`${auctionKey}-${pot.info.bidderAct}`],
        pot,
      })),
    ];

    const myPayingAccount = accountByMint.get(auctionView.auction.info.tokenMint);

    let escrowBalance = 0;
    const tokenAccountBalance = await connection.getTokenAccountBalance(toPublicKey(auctionView.auctionManager.acceptPayment));
    if (tokenAccountBalance.value.uiAmount !== undefined && tokenAccountBalance.value.uiAmount !== null)
      escrowBalance = tokenAccountBalance.value.uiAmount;

    if (escrowBalance > 0) {
      if (myPayingAccount !== undefined) {
        await settle(
          connection,
          wallet,
          auctionView,
          bidsToClaim.map(b => b.pot),
          myPayingAccount.pubkey,
          accountByMint,
        );
        console.log('settled ' + auctionKey);
      } else {
        console.error('myPayingAccount = undefined');
      }
    } else {
      console.error('escrow is 0');
    }
  };

  const settleAll = async () => {
    console.log('AUCTIONS COUNT: ' + auctionsNeedingSettling.length);
    for (let i = 0; i < auctionsNeedingSettling.length; i++) {
      const auctionView: AuctionView = auctionsNeedingSettling[i];
      const auctionKey = auctionView.auction.pubkey;
      console.log('settling ' + auctionKey);
      await settleEscrow(auctionView);
    }
  };

  const getCreated = async () => {
    console.log(metadata);
  };

  return (
    <Layout>
      Bero works
      <Button
        type='primary'
        size='large'
        className='action-btn'
        onClick={async () => {
          await settleAll();
        }}
      >
        SETTLE OUTSTANDING
      </Button>
      <Button
        type='primary'
        size='large'
        className='action-btn'
        onClick={async () => {
          await getCreated();
        }}
      >
        GET MY ARTWORK
      </Button>
    </Layout>
  );
};
