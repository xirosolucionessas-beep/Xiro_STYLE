import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { useWebStyles } from './shared';

interface BaseProps {
  children: ReactNode;
}

type StaticProps = BaseProps & { as?: 'div' | 'section' | 'article' | 'li'; 'aria-labelledby'?: string; href?: undefined; onPress?: undefined };
type LinkProps = BaseProps & { href: string; onPress?: undefined; as?: undefined } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'style' | 'href' | 'children'>;
type ButtonProps = BaseProps & { onPress: () => void; href?: undefined; as?: undefined };

export type CardProps = StaticProps | LinkProps | ButtonProps;

/** Tarjeta: contenedor estático, enlace (`href`) o botón (`onPress`) — siempre un elemento interactivo real cuando hace algo. */
export function Card(props: CardProps) {
  useWebStyles();
  if ('href' in props && props.href !== undefined) {
    const { children, href, ...rest } = props;
    return (
      <a {...rest} href={href} className="xw-card">
        {children}
      </a>
    );
  }
  if ('onPress' in props && props.onPress) {
    return (
      <button type="button" className="xw-card" onClick={props.onPress}>
        {props.children}
      </button>
    );
  }
  const { as: Tag = 'div', children, ...rest } = props as StaticProps;
  return (
    <Tag className="xw-card" aria-labelledby={rest['aria-labelledby']}>
      {children}
    </Tag>
  );
}
