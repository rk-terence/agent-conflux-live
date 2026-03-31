import { useState } from 'react'
import { SetupScreen } from './components/SetupScreen'
import { DiscussionScreen } from './components/DiscussionScreen'
import { useDiscussion } from './hooks/useDiscussion'
import type { Participant } from '@core/domain/types.ts'
import type { ModelGateway } from '@core/model-gateway/types.ts'

export type Screen = 'setup' | 'discussion'

export type SetupConfig = {
  topic: string
  participants: Participant[]
  durationSeconds: number
  gateway: ModelGateway
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const discussion = useDiscussion()

  const handleStart = (config: SetupConfig) => {
    discussion.start(config)
    setScreen('discussion')
  }

  const handleBack = () => {
    discussion.stop()
    setScreen('setup')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {screen === 'setup' ? (
        <SetupScreen onStart={handleStart} />
      ) : (
        <DiscussionScreen
          discussion={discussion}
          onBack={handleBack}
        />
      )}
    </div>
  )
}
