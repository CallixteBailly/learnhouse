/**
 * Visuels de fallback partagés pour les cours sans miniature.
 * Détection du métier (nom + tags) → photo Unsplash + libellé,
 * sinon photo aléatoire déterministe (stable par UUID).
 * Utilisé par la landing (hero + cards), la page cours et les cartes catalogue.
 */

/** Parse tags d'un cours (string JSON, string CSV ou tableau) → tableau de strings */
export function getCourseTags(course: any): string[] {
  const raw = course?.tags
  if (Array.isArray(raw)) return raw.filter(Boolean)
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(Boolean) : raw.split(',').map((s) => s.trim()).filter(Boolean)
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean)
    }
  }
  return []
}

/** Visuel distinctif par métier quand pas de thumbnail image. */
export const METIER_VISUALS: Record<string, { image: string; label: string }> = {
  restaurant: {
    image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=80',
    label: 'Restaurateur',
  },
  barbier: {
    image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80',
    label: 'Barbier',
  },
  artisan: {
    image: 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=800&q=80',
    label: 'Artisan',
  },
  garagiste: {
    image: 'https://images.unsplash.com/photo-1632823469850-1b7b1e8b7e1e?auto=format&fit=crop&w=800&q=80',
    label: 'Garagiste',
  },
  coiffeur: {
    image: 'https://images.unsplash.com/photo-1560066984-138dadb4c035?auto=format&fit=crop&w=800&q=80',
    label: 'Coiffeur',
  },
  ia: {
    image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=800&q=80',
    label: 'IA',
  },
  immobilier: {
    image: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
    label: 'Immobilier',
  },
  digital: {
    image: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=800&q=80',
    label: 'Digital',
  },
  marketing: {
    image: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
    label: 'Marketing',
  },
}

/** Pool d'images de fallback aléatoires (style tech/business) quand aucun
 *  métier n'est détecté — pioche déterministe basée sur l'UUID du cours. */
const FALLBACK_IMAGES = [
  'https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=800&q=80',
]

/** Détecte le métier depuis le nom + tags du cours → visuel associé. */
export function detectMetier(course: any): { image: string; label: string } {
  const name = (course?.name || '').toLowerCase()
  const tags = getCourseTags(course).join(' ').toLowerCase()
  const haystack = `${name} ${tags}`
  // Ordre de priorité : métiers spécifiques d'abord
  if (haystack.includes('restaurant') || haystack.includes('restaur'))
    return METIER_VISUALS.restaurant
  if (haystack.includes('barbier') || haystack.includes('coiffeur'))
    return METIER_VISUALS.coiffeur
  if (haystack.includes('artisan'))
    return METIER_VISUALS.artisan
  if (haystack.includes('garagiste') || haystack.includes('auto') || haystack.includes('mécan'))
    return METIER_VISUALS.garagiste
  if (haystack.includes('immobilier') || haystack.includes('agent'))
    return METIER_VISUALS.immobilier
  if (haystack.includes('digital') || haystack.includes('transformation'))
    return METIER_VISUALS.digital
  if (haystack.includes('marketing') || haystack.includes('communication'))
    return METIER_VISUALS.marketing
  if (haystack.includes('ia') || haystack.includes('intelligence') || haystack.includes('automatisation'))
    return METIER_VISUALS.ia
  // Fallback : image aléatoire déterministe (stable par UUID)
  const uuid: string = course?.course_uuid || ''
  const idx = uuid.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % FALLBACK_IMAGES.length
  return { image: FALLBACK_IMAGES[idx], label: '' }
}
