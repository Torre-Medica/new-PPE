import { useEffect } from 'react';

// Pantallas completas que no caben en 1280x720 a tamano normal: mientras estan
// montadas, <html> lleva la clase compact-screen (en styles.css reduce la base rem
// solo en pantallas de 760 px de alto o menos). Contador por si se montan dos.
let mounted = 0;

export function useCompactScreen() {
  useEffect(() => {
    mounted += 1;
    document.documentElement.classList.add('compact-screen');
    return () => {
      mounted -= 1;
      if (mounted <= 0) {
        mounted = 0;
        document.documentElement.classList.remove('compact-screen');
      }
    };
  }, []);
}
