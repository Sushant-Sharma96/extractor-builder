/**
 * EventCard — reusable design-system component for large apps.
 * Contract: docs/EVENT_CARD_COMPONENT_STANDARD.md
 *
 * Props mirror the HTML data model so React / Vue / plain HTML stay aligned.
 */
import './EventCard.css';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {string} [props.imageUrl]
 * @param {string} [props.imageAlt]
 * @param {'online'|'offline'|string} [props.mode]
 * @param {string} [props.registrationEndLabel] — display text
 * @param {string} [props.registrationEndIso] — ISO date for <time datetime>
 * @param {string} [props.ctaLabel]
 * @param {() => void} [props.onRegister]
 * @param {boolean} [props.awarded]
 * @param {string} [props.className]
 */
export default function EventCard({
  title,
  imageUrl = '',
  imageAlt = '',
  mode = 'offline',
  registrationEndLabel = '',
  registrationEndIso = '',
  ctaLabel = 'Register Now',
  onRegister,
  awarded = true,
  className = '',
}) {
  const statusLabel = mode === 'online' ? 'Online' : mode === 'offline' ? 'Offline' : String(mode);
  const statusAria = `${statusLabel} event`;

  return (
    <article className={`event-card ${className}`.trim()} data-mode={mode}>
      <div className="event-card__media">
        {imageUrl ? (
          <img
            className="event-card__image"
            src={imageUrl}
            alt={imageAlt || title}
            width={128}
            height={100}
          />
        ) : (
          <div className="event-card__image event-card__image--placeholder" role="img" aria-label={imageAlt || title} />
        )}
      </div>

      <div className="event-card__body">
        <div className="event-card__header">
          <h3 className="event-card__title">{title}</h3>
          {awarded && (
            <p className="event-card__meta" aria-label="Awards">
              <span className="event-card__award" aria-hidden="true">🏆</span>
              <span className="event-card__award event-card__award--ghost" aria-hidden="true">🏆</span>
              <span className="visually-hidden">Awarded event</span>
            </p>
          )}
        </div>
        {registrationEndLabel && (
          <p className="event-card__date">
            Registration Ends on{' '}
            {registrationEndIso ? (
              <time dateTime={registrationEndIso}>{registrationEndLabel}</time>
            ) : (
              <span>{registrationEndLabel}</span>
            )}
          </p>
        )}
      </div>

      <div className="event-card__actions">
        <p className="event-card__status" aria-label={statusAria}>
          {statusLabel}
        </p>
        <button
          className="event-card__button"
          type="button"
          onClick={onRegister}
        >
          {ctaLabel}
        </button>
      </div>
    </article>
  );
}
