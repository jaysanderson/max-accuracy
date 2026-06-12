import { useState } from 'react';
import { session } from './lib/session';
import { CalibrationScreen } from './screens/CalibrationScreen';
import { CaptureScreen } from './screens/CaptureScreen';
import { DiagnosticScreen } from './screens/DiagnosticScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MarkerSheetScreen } from './screens/MarkerSheetScreen';
import { MeasureScreen } from './screens/MeasureScreen';
import { NewMeasurementScreen } from './screens/NewMeasurementScreen';
import { ProfilesScreen } from './screens/ProfilesScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TestLogScreen } from './screens/TestLogScreen';
import type { MeasureSetup } from './types';

type Route =
  | 'home'
  | 'new'
  | 'capture'
  | 'measure'
  | 'testlog'
  | 'diagnostic'
  | 'profiles'
  | 'calibrate'
  | 'markers'
  | 'settings';

export default function App() {
  const [route, setRoute] = useState<Route>('home');
  const [setup, setSetup] = useState<MeasureSetup | null>(null);

  const home = () => setRoute('home');

  return (
    <div className="fixed inset-0 bg-zinc-950 text-zinc-100">
      {route === 'home' && <HomeScreen onNav={(r) => setRoute(r)} />}
      {route === 'new' && (
        <NewMeasurementScreen
          onBack={home}
          onStart={(s: MeasureSetup) => {
            setSetup(s);
            setRoute('capture');
          }}
        />
      )}
      {route === 'capture' && setup && (
        <CaptureScreen setup={setup} onBack={() => setRoute('new')} onCaptured={() => setRoute('measure')} />
      )}
      {route === 'measure' && setup && (
        <MeasureScreen
          setup={setup}
          onRetake={() => setRoute('capture')}
          onSaved={() => setRoute(setup.testMode ? 'testlog' : 'home')}
          onAbort={() => {
            session.burst = null;
            setRoute('capture');
          }}
        />
      )}
      {route === 'testlog' && <TestLogScreen onBack={home} />}
      {route === 'diagnostic' && <DiagnosticScreen onBack={home} />}
      {route === 'profiles' && <ProfilesScreen onBack={home} onCalibrate={() => setRoute('calibrate')} />}
      {route === 'calibrate' && <CalibrationScreen onBack={() => setRoute('profiles')} />}
      {route === 'markers' && <MarkerSheetScreen onBack={home} />}
      {route === 'settings' && <SettingsScreen onBack={home} />}
    </div>
  );
}
