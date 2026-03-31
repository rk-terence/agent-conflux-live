import { useState } from 'react'
import { SetupScreen } from './components/SetupScreen'
import { DiscussionScreen } from './components/DiscussionScreen'

export type Screen = 'setup' | 'discussion'

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {screen === 'setup' ? (
        <SetupScreen onStart={() => setScreen('discussion')} />
      ) : (
        <DiscussionScreen onBack={() => setScreen('setup')} />
      )}
    </div>
  )
}
