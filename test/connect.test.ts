import { getPublicKey, signEvent, Event, nip26 } from 'nostr-tools';
import { Connect, ConnectURI, NostrSigner, TimeRanges } from '../src';
import { sleep } from './utils';

jest.setTimeout(7500);

// web app (this is ephemeral and represents the currention session)
const webSK =
  '5acff99d1ad3e1706360d213fd69203312d9b5e91a2d5f2e06100cc6f686e5b3';
const webPK = getPublicKey(webSK);
//console.debug('webPk', webPK);

// mobile app with keys with the nostr identity
const mobileSK =
  'ed779ff047f99c95f732b22c9f8f842afb870c740aab591776ebc7b64e83cf6c';
const mobilePK = getPublicKey(mobileSK);
//console.debug('mobilePK', mobilePK);

class MobileHandler extends NostrSigner {
  async get_public_key(): Promise<string> {
    return getPublicKey(this.self.secret);
  }
  async sign_event(event: any): Promise<string> {
    const sigEvt = signEvent(event, this.self.secret);
    return Promise.resolve(sigEvt);
  }
  async delegate(
    delegatee: string,
    conditions: {
      kind?: number;
      until?: number;
      since?: number;
    }
  ): Promise<string> {
    const delegateParameters: nip26.Parameters = {
      pubkey: delegatee,
      kind: conditions.kind,
      since: conditions.since || Math.round(Date.now() / 1000),
      until:
        conditions.until ||
        Math.round(Date.now() / 1000) + 60 * 60 * 24 * 30 /* 30 days */,
    };
    const delegation = nip26.createDelegation(
      this.self.secret,
      delegateParameters
    );
    return Promise.resolve(delegation.sig);
  }
}

describe('ConnectURI', () => {
  it('roundtrip connectURI', async () => {
    const connectURI = new ConnectURI({
      target: `b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4`,
      relay: 'wss://relay.house',
      metadata: {
        name: 'Vulpem',
        description:
          'Enabling the next generation of bitcoin-native financial services',
        url: 'https://vulpem.com',
        icons: ['https://vulpem.com/1000x860-p-500.422be1bc.png'],
      },
    });
    const url = ConnectURI.fromURI(connectURI.toString());
    expect(url.target).toBe(
      'b889ff5b1513b641e2a139f661a661364979c5beee91842f8f0ef42ab558e9d4'
    );
    expect(url.relay).toBe('wss://relay.house');
    expect(url.metadata.name).toBe('Vulpem');
    expect(url.metadata.description).toBe(
      'Enabling the next generation of bitcoin-native financial services'
    );
    expect(url.metadata.url).toBe('https://vulpem.com');
    expect(url.metadata.icons).toBeDefined();
    expect(url.metadata.icons!.length).toBe(1);
    expect(url.metadata.icons![0]).toBe(
      'https://vulpem.com/1000x860-p-500.422be1bc.png'
    );
  });
});

describe('Connect', () => {
  beforeAll(async () => {
    try {
      // start listening for connect messages on the mobile app
      const remoteHandler = new MobileHandler({
        secretKey: mobileSK,
        relay: 'wss://relay.house',
      });
      await remoteHandler.listen();
    } catch (error) {
      console.error(error);
      throw error;
    }
  });

  it('returns pubkey and delegation', async () => {
    // start listening for connect messages on the web app
    const connect = new Connect({
      secretKey: webSK,
      target: mobilePK,
    });
    await connect.init();

    sleep(1000);

    // send the get_public_key message to the mobile app from the web
    const pubkey = await connect.getPublicKey();
    expect(pubkey).toBe(mobilePK);

    // send the delegate message to the mobile app from the web to ask for permission to sign kind 1 notes on behalf of the user for 5 mins
    const sig = await connect.delegate(webPK, {
      kind: 1,
      until: TimeRanges.FIVE_MINS,
    });
    expect(sig).toBeTruthy();
  });

  it.skip('connect', async () => {
    const testHandler = jest.fn();

    // start listening for connect messages on the web app
    const connect = new Connect({ secretKey: webSK });
    connect.events.on('connect', testHandler);
    await connect.init();

    await sleep(100);

    // send the connect message to the web app from the mobile
    const connectURI = new ConnectURI({
      target: webPK,
      relay: 'wss://relay.house',
      metadata: {
        name: 'My Website',
        description: 'lorem ipsum dolor sit amet',
        url: 'https://vulpem.com',
        icons: ['https://vulpem.com/1000x860-p-500.422be1bc.png'],
      },
    });
    await connectURI.approve(mobileSK);

    expect(testHandler).toBeCalledTimes(1);
  });
  it.skip('returns a signed event', async () => {
    // start listening for connect messages on the mobile app
    const remoteHandler = new MobileHandler({
      secretKey: mobileSK,
      relay: 'wss://relay.house',
    });

    // define how to comnsume the event

    remoteHandler.events.on('sign_event_request', (event: Event) => {
      console.log(event.pubkey);
      // ⚠️⚠️⚠️ IMPORTANT: always check if the app is connected
      //if (!remoteHandler.isConnected(event.pubkey)) return;
      // assume  user clicks on approve button on the UI
      remoteHandler.events.emit('sign_event_approve');
    });

    // add app as connected app
    remoteHandler.addConnectedApp(webPK);

    // start listening for request messages on the mobile app
    await remoteHandler.listen();

    await sleep(1000);

    // start listening for connect messages on the web app
    const connect = new Connect({
      secretKey: webSK,
      target: mobilePK,
    });
    await connect.init();

    await sleep(1000);

    const event = await connect.signEvent({
      kind: 1,
      pubkey: mobilePK,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: '🏃‍♀️ Testing Nostr Connect',
    });
    expect(event).toBeDefined();
  });
});
