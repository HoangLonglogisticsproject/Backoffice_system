import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/types/translate';
import emptyTruck from '@/assets/img/car.png';

/**
 * "There is nothing here" — drawn once, for every empty list in the portal.
 *
 * ★ ONE COMPONENT, BECAUSE AN EMPTY SCREEN IS STILL A SCREEN. A driver who
 * opens the portal to nothing sees this more often than they see a trip: on a
 * day off, on the first morning of an account, between turns. A bare grey
 * sentence reads as a page that failed to load; the illustration says "we are
 * working, there is simply nothing today".
 *
 * ★ THE PICTURE IS DECORATION, AND IT SAYS SO. `alt=""` keeps it out of the
 * accessibility tree entirely — the heading and the line under it already say
 * everything, and a screen reader describing a cartoon lorry adds nothing but
 * noise. Nothing here is the only copy of any fact.
 *
 * ★ AND THE ACTION IS OPTIONAL, because not every emptiness has a next step.
 * "No trips today" has one — look at tomorrow. "No earlier trips" has none, and
 * a button that merely moved the driver somewhere unrelated would be worse than
 * the blank space it filled.
 */

interface Props {
  /** The headline. One short phrase — never a sentence with a full stop. */
  title: TranslationKey;
  /** The line under it: what is empty, in the driver's own words. */
  message: TranslationKey;
  /** The one thing worth doing from here, if there is one. */
  action?: { label: TranslationKey; icon?: ReactNode; onClick: () => void };
}

export function DriverEmptyState({ title, message, action }: Readonly<Props>) {
  const { t } = useLanguage();

  return (
    <div className="flex flex-col items-center px-4 py-12 text-center sm:py-16">
      {/*
        ★ CAPPED BY WIDTH, NOT BY HEIGHT, and `h-auto` with it: the file is a
        wide landscape drawing, so a height cap would letterbox it on a phone
        held upright. `select-none` because a long-press on a picture that is
        not a link should not offer to copy it.
      */}
      <img
        src={emptyTruck}
        alt=""
        aria-hidden
        draggable={false}
        className="mb-6 h-auto w-full max-w-[280px] select-none sm:max-w-[320px]"
      />

      <h2 className="text-xl font-bold text-foreground sm:text-2xl">{t(title)}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground sm:text-base">{t(message)}</p>

      {action ? (
        <Button
          size="lg"
          // Tall and thumb-sized, like every other primary action in the portal.
          className="mt-6 h-12 px-6 text-base"
          onClick={action.onClick}
        >
          {action.icon}
          {t(action.label)}
        </Button>
      ) : null}
    </div>
  );
}
