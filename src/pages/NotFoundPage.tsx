import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[55vh] max-w-[720px] flex-col justify-center px-5 py-16">
      <p className="meta">Ошибка 404</p>
      <h1 className="mt-3 text-4xl font-extrabold tracking-tight">Страница не найдена</h1>
      <p className="mt-4 text-muted-foreground">Возможно, адрес изменился или публикация была удалена.</p>
      <Link to="/feed" className="btn-primary mt-7 self-start"><ArrowLeft size={15} aria-hidden="true" /> Вернуться в ленту</Link>
    </div>
  )
}
