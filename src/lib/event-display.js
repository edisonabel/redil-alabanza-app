const getText = (value) => (typeof value === 'string' ? value.trim() : '');

const BULLET_SEPARATOR = ` \u2022 `;
const EM_DASH_SEPARATOR = ` \u2014 `;
const THEME_SEPARATORS = [BULLET_SEPARATOR, ' | ', EM_DASH_SEPARATOR, ' - '];

export const splitTemaPredicacion = (rawTema = '', fallbackTitle = '') => {
  const temaValue = getText(rawTema);
  const fallbackValue = getText(fallbackTitle);
  const displayValue = temaValue || fallbackValue;

  if (!displayValue) {
    return {
      theme: '',
      preacher: '',
    };
  }

  for (const separator of THEME_SEPARATORS) {
    const splitIndex = displayValue.lastIndexOf(separator);
    if (splitIndex <= 0 || splitIndex >= displayValue.length - separator.length) continue;

    const theme = displayValue.slice(0, splitIndex).trim();
    const preacher = displayValue.slice(splitIndex + separator.length).trim();

    if (theme && preacher) {
      return { theme, preacher };
    }
  }

  return {
    theme: displayValue,
    preacher: '',
  };
};

export const getEventThemeAndPreacher = (eventLike = {}, fallbackTitle = '') => {
  const fallbackValue = getText(fallbackTitle) || getText(eventLike?.titulo);
  const explicitTheme = getText(eventLike?.tema_predicacion ?? eventLike?.tema);
  const explicitPreacher = getText(eventLike?.predicador);

  if (explicitPreacher) {
    return {
      theme: explicitTheme || fallbackValue,
      preacher: explicitPreacher,
    };
  }

  return splitTemaPredicacion(explicitTheme || fallbackValue, fallbackValue);
};

export const buildEventHeadline = (eventLike = {}, fallbackTitle = '') => {
  const { theme, preacher } = getEventThemeAndPreacher(eventLike, fallbackTitle);
  const fallbackValue = getText(fallbackTitle) || getText(eventLike?.titulo) || 'Servicio';

  if (theme && preacher) return `${theme}${BULLET_SEPARATOR}${preacher}`;
  return theme || preacher || fallbackValue;
};
