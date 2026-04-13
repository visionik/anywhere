import {
  LocationManager,
  SimulatorSource,
  type LocationManagerOptions,
  type Position,
} from '../../src/index.js';

type OfflineBehavior = NonNullable<LocationManagerOptions['offlineBehavior']>;

const behaviors: OfflineBehavior[] = ['event', 'stale', 'retry'];

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildRoute = (source: string): Position[] => [
  {
    latitude: 37.6188056,
    longitude: -122.3754167,
    altitude: 4,
    speed: 68,
    heading: 284,
    timestamp: new Date(),
    source,
  },
  {
    latitude: 37.61915,
    longitude: -122.37395,
    altitude: 8,
    speed: 70,
    heading: 286,
    timestamp: new Date(),
    source,
  },
];

const formatPosition = (position: Position): string => {
  const staleSuffix = position.stale ? ' stale=true' : '';
  return `${position.source} lat=${position.latitude.toFixed(6)} lon=${position.longitude.toFixed(6)} alt=${position.altitude ?? 'n/a'} heading=${position.heading ?? 'n/a'}${staleSuffix}`;
};

async function runScenario(offlineBehavior: OfflineBehavior): Promise<void> {
  console.log(`\n=== offlineBehavior=${offlineBehavior} ===`);

  const manager = new LocationManager({
    sources: [
      new SimulatorSource({
        sourceId: 'gdl90',
        route: buildRoute('gdl90'),
        intervalMs: 250,
        loop: false,
      }),
    ],
    priorityOrder: ['gdl90'],
    offlineBehavior,
    retryIntervalMs: 400,
  });

  manager.on('sourceChange', (from, to) => {
    console.log(`[source-change] ${from ?? 'none'} -> ${to ?? 'none'}`);
  });

  manager.on('position', (position) => {
    console.log(`[position] ${formatPosition(position)}`);
  });

  manager.on('offline', () => {
    console.log('[offline] all sources unavailable');
  });

  manager.start();
  await wait(offlineBehavior === 'retry' ? 1600 : 900);
  manager.stop();
}

async function main(): Promise<void> {
  console.log('Anywhere EFB demo');
  console.log(
    'Demonstrates SimulatorSource driving LocationManager through each offline behavior.',
  );

  for (const behavior of behaviors) {
    await runScenario(behavior);
  }

  console.log('\nDemo complete.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
