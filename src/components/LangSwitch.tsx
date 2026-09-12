import { useI18n } from '../lib/i18n'

/** 语言切换：中文 / EN。两个语言各一个分段，当前语言高亮。 */
export function LangSwitch({ className }: { className?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <div
      className={className ? `lang-switch ${className}` : 'lang-switch'}
      role="group"
      aria-label={t('lang.label')}
    >
      <button
        type="button"
        className={lang === 'zh' ? 'on' : undefined}
        aria-pressed={lang === 'zh'}
        onClick={() => setLang('zh')}
      >
        {t('lang.zh')}
      </button>
      <button
        type="button"
        className={lang === 'en' ? 'on' : undefined}
        aria-pressed={lang === 'en'}
        onClick={() => setLang('en')}
      >
        {t('lang.en')}
      </button>
    </div>
  )
}
