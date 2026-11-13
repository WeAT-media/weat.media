import { AtSign, Github, Send } from 'lucide-react'
import type { Provider } from '@/lib/api'

const badge = 'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full font-sans text-[11px] font-bold leading-none text-white'

export default function ProviderIcon({ provider }: { provider: Provider }) {
  switch (provider) {
    case 'yandex':
      return <span aria-hidden="true" className={`${badge} bg-[#fc3f1d]`}>Я</span>
    case 'google':
      return <span aria-hidden="true" className={`${badge} bg-[#4285f4]`}>G</span>
    case 'github':
      return <Github size={18} aria-hidden="true" />
    case 'atproto':
      return (
        <span aria-hidden="true" className={`${badge} bg-[#0a7aff]`}>
          <AtSign size={11} />
        </span>
      )
    case 'telegram':
      return (
        <span aria-hidden="true" className={`${badge} bg-[#229ed9]`}>
          <Send size={10} />
        </span>
      )
  }
}
