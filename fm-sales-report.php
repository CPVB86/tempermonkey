<?php
/**
 * Plugin Name:       CPVB - F&M E-Warehousing Sales Reports
 * Description:       Genereer een overzicht van alle verkochte producten en retouren per volle maand.
 * Plugin URI:		  https://www.runiversity.nl/
 * Version:           1.6.0
 * Author:            CPVB
 * Author URI: https://www.runiversity.nl/
 * Requires at least: 5.4
 * Requires PHP:      7.0
 * WC requires at least: 4.0
 * WC tested up to:   9.0
 */

if ( ! defined( 'ABSPATH' ) ) exit;

if ( ! class_exists( 'WC_Monthly_Sales_Export_TSV' ) ) :
class WC_Monthly_Sales_Export_TSV {
	const NONCE = 'wc_mse_export';

	private $size_attribute_keys = array( 'pa_maat','maat','pa_size','size' );

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_admin_page' ) );
	}

	public function add_admin_page() {
		add_submenu_page(
			'woocommerce',
			__( 'Sales Report', 'wc-mse' ),
			__( 'Sales Report', 'wc-mse' ),
			'manage_woocommerce',
			'wc-monthly-sales-export',
			array( $this, 'render_admin_page' )
		);
	}

	public function render_admin_page() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) {
			wp_die( __( 'Je hebt geen rechten voor deze pagina.', 'wc-mse' ) );
		}

		$selected_year  = isset( $_POST['year'] ) ? (int) $_POST['year'] : (int) gmdate( 'Y' );
		$selected_month = isset( $_POST['month'] ) ? (int) $_POST['month'] : (int) gmdate( 'n' );

		$tsv = '';
		$filename = '';
		$just_generated = false;

		if ( isset( $_POST['do_export'] ) && isset( $_POST['_wpnonce'] ) && wp_verify_nonce( $_POST['_wpnonce'], self::NONCE ) ) {
			$year  = $selected_year;
			$month = $selected_month;
			$res   = $this->build_tsv_for_month( $year, $month );
			$tsv   = $res['content'];
			$filename = $res['filename'];
			$just_generated = true;
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'F & M E-Warehousing Sales Report', 'wc-mse' ); ?></h1>
			<p><?php esc_html_e( 'Genereer een overzicht van alle verkochte producten en retouren per volle maand.', 'wc-mse' ); ?></p>

			<form method="post" action="">
				<?php wp_nonce_field( self::NONCE ); ?>
				<input type="hidden" name="do_export" value="1" />
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="mse_year"><?php esc_html_e( 'Jaar', 'wc-mse' ); ?></label></th>
						<td>
							<select id="mse_year" name="year">
								<?php
								$current_year = (int) gmdate( 'Y' );
								for ( $y = $current_year + 1; $y >= $current_year - 10; $y-- ) {
									printf( '<option value="%1$d" %2$s>%1$d</option>', $y, selected( $selected_year, $y, false ) );
								}
								?>
							</select>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="mse_month"><?php esc_html_e( 'Maand', 'wc-mse' ); ?></label></th>
						<td>
							<select id="mse_month" name="month">
								<?php
								for ( $m = 1; $m <= 12; $m++ ) {
									$label = date_i18n( 'F', mktime( 0, 0, 0, $m, 1 ) );
									printf( '<option value="%1$d" %2$s>%3$s</option>', $m, selected( $selected_month, $m, false ), esc_html( ucfirst( $label ) ) );
								}
								?>
							</select>
						</td>
					</tr>
				</table>
				<p class="submit"><button type="submit" class="button button-primary"><?php esc_html_e( 'Genereer Sales Report', 'wc-mse' ); ?></button></p>
			</form>

			<?php if ( $just_generated ) { ?>
				<h2 style="margin-top:2rem;">📄 <?php echo esc_html( sprintf( __( 'Sales Report voor %s %d', 'wc-mse' ), date_i18n( 'F', mktime(0,0,0,$selected_month,1) ), $selected_year ) ); ?></h2>
				<p><?php esc_html_e( 'Kopieer de inhoud of download als bestand. Het is tab-gescheiden (TSV) zodat Excel/Sheets het netjes kan inlezen.', 'wc-mse' ); ?></p>
				<input type="hidden" id="mse-filename" value="<?php echo esc_attr( $filename ); ?>" />
				<p>
					<button id="mse-download" class="button button-primary">⬇ <?php esc_html_e( 'Download .tsv', 'wc-mse' ); ?></button>
					<button id="mse-copy" class="button">📋 <?php esc_html_e( 'Kopieer', 'wc-mse' ); ?></button>
				</p>
				<textarea id="mse-tsv" rows="20" style="width:100%;font-family:Menlo,Consolas,monospace;white-space:pre;"><?php echo esc_textarea( $tsv ); ?></textarea>
				<script>
				(function(){
				  var d=document, a=function(id){return d.getElementById(id)};
				  var btn=a('mse-download'), copy=a('mse-copy'), area=a('mse-tsv'), name=a('mse-filename');
				  if(btn){btn.addEventListener('click',function(e){e.preventDefault();
				    var blob=new Blob([area.value],{type:'text/tab-separated-values;charset=utf-8'});
				    var link=d.createElement('a'); link.href=URL.createObjectURL(blob);
				    link.download=name && name.value ? name.value : 'export.tsv';
				    d.body.appendChild(link); link.click(); setTimeout(function(){URL.revokeObjectURL(link.href);link.remove();},1500);
				  });}
				  if(copy){copy.addEventListener('click',function(e){e.preventDefault(); area.focus(); area.select(); try{document.execCommand('copy'); copy.textContent='✔ Gekopieerd'; setTimeout(function(){copy.textContent='📋 Kopieer';},1200);}catch(err){}});}
				})();
				</script>
			<?php } ?>

			<p style="margin-top:2rem;"><em><?php esc_html_e( 'Kolommen: Productnaam, ID, SKU (variant), Size (variant), Aantal verkocht, Prijs/stuk excl. btw, Prijs totaal excl. btw. Retouren staan apart met negatieve aantallen/bedragen. Onderaan: Totaal omzet excl. btw.', 'wc-mse' ); ?></em></p>
		</div>
		<?php
	}

	private function build_tsv_for_month( $year, $month ) {
		list( $start_site, $end_site ) = $this->get_month_bounds_in_site_tz( $year, $month );
		$start_utc = clone $start_site; $start_utc->setTimezone( new DateTimeZone( 'UTC' ) );
		$end_utc   = clone $end_site;   $end_utc->setTimezone( new DateTimeZone( 'UTC' ) );

		// VERKOPEN: orders waarvan de AANMAAK-datum (date_created) in de maand valt.
		// Status mag wc-completed of wc-refunded zijn; we kijken dus naar de maand van bestellen, niet naar voltooid-datum.
		$sales_orders  = $this->query_orders_after( 'shop_order', array( 'wc-completed', 'wc-refunded' ), $start_utc );
		$sales_items   = $this->collect_sales_items_by_created_date( $sales_orders, $start_utc, $end_utc );

		// RETOUREN: refund-orders op refund-datum
		$refund_orders = $this->query_orders_after( 'shop_order_refund', null, $start_utc );
		$refund_items  = $this->collect_refund_items( $refund_orders, $start_utc, $end_utc );

		// Fallback: orders die in deze maand op wc-refunded zijn gezet, zónder refund-order in de maand
		$manual_refund_items = $this->collect_manual_refunded_orders( $start_utc, $end_utc );

		$agg_sales   = $this->aggregate_items( $sales_items, false );
		$agg_refunds = $this->aggregate_items( array_merge( $refund_items, $manual_refund_items ), true );

		// Verzamel unieke order-ID's voor debug (debet = verkopen, credit = retouren)
		$sales_ids  = array();
		$credit_ids = array();
		foreach ( $sales_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $sales_ids[ $oid ] = true; } }
		foreach ( $refund_items as $p ) {
			$o = $p[1];
			$oid = 0;
			if ( $o && method_exists( $o, 'get_parent_id' ) ) { $oid = (int) $o->get_parent_id(); }
			if ( ! $oid && $o && method_exists( $o, 'get_id' ) ) { $oid = (int) $o->get_id(); }
			if ( $oid ) { $credit_ids[ $oid ] = true; }
		}
		foreach ( $manual_refund_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $credit_ids[ $oid ] = true; } }
		$si = array_keys( $sales_ids ); sort( $si, SORT_NUMERIC );
		$ci = array_keys( $credit_ids ); sort( $ci, SORT_NUMERIC );
		$sales_ids_str  = implode( ', ', $si );
		$credit_ids_str = implode( ', ', $ci );

		$lines = array();
		$lines[] = $this->tsv_row( array( 'Productnaam', 'ID', 'SKU', 'Size', 'Aantal verkocht', 'Prijs/stuk excl. btw', 'Prijs totaal excl. btw' ) );

		$net_total = 0.0;
		foreach ( $agg_sales as $row ) {
			$net_total += (float) $row['total'];
			$lines[] = $this->tsv_row( array( $row['name'], $row['id'], $row['sku'], $row['size'], $this->format_qty( $row['qty'] ), $this->format_money( $row['unit_price'] ), $this->format_money( $row['total'] ) ) );
		}

		if ( ! empty( $agg_refunds ) ) {
			$lines[] = '';
			$lines[] = '# RETOUREN (negatieve aantallen en bedragen)';
			foreach ( $agg_refunds as $row ) {
				$net_total += (float) $row['total'];
				$lines[] = $this->tsv_row( array( $row['name'], $row['id'], $row['sku'], $row['size'], $this->format_qty( $row['qty'] ), $this->format_money( $row['unit_price'] ), $this->format_money( $row['total'] ) ) );
			}
		}


		$lines[] = '';
		$lines[] = $this->tsv_row( array( 'Totaal omzet excl. btw', '', '', '', '', '', $this->format_money( $net_total ) ) );	
		
		// Debug regels met betrokken bestellingen
		$lines[] = '';
		$lines[] = 'Debiteuren: ' . $sales_ids_str;
		$lines[] = 'Crediteuren: ' . $credit_ids_str;


		$content  = implode( "
", $lines ) . "
";
		$filename = sprintf( 'wc-export-%04d-%02d.tsv', $year, $month );
		return array( 'content' => $content, 'filename' => $filename );
	}

	private function get_month_bounds_in_site_tz( $year, $month ) {
		$tz = $this->get_site_timezone();
		$start = new DateTime( sprintf( '%04d-%02d-01 00:00:00', $year, $month ), $tz );
		$end   = clone $start; $end->modify( 'first day of next month 00:00:00' );
		return array( $start, $end );
	}

	private function get_site_timezone() {
		if ( function_exists( 'wp_timezone' ) ) return wp_timezone();
		$tz_string = get_option( 'timezone_string' );
		if ( $tz_string ) { try { return new DateTimeZone( $tz_string ); } catch ( Exception $e ) {} }
		return new DateTimeZone( 'UTC' );
	}

	// Query op VOLTOOID-datum > start; < end filteren we in PHP. Status mag wc-completed of wc-refunded zijn.
	private function query_orders_completed_after( $statuses, $start_utc ) {
		$args = array(
			'limit'          => -1,
			'paginate'       => false,
			'type'           => 'shop_order',
			'return'         => 'objects',
			'currency'       => '',
			'status'         => $statuses,
			'date_completed' => '>' . $start_utc->format( 'Y-m-d H:i:s' ), // string comparator voor brede compat
		);
		return $this->get_orders_compat( $args );
	}

	// Generiek: query op aanmaakdatum > start (string comparator). < end filteren we in PHP.
	private function query_orders_after( $type, $statuses, $start_utc ) {
		$args = array(
			'limit'        => -1,
			'paginate'     => false,
			'type'         => $type,
			'return'       => 'objects',
			'currency'     => '',
			'date_created' => '>' . $start_utc->format( 'Y-m-d H:i:s' ), // string comparator
		);
		if ( $statuses ) $args['status'] = $statuses;
		return $this->get_orders_compat( $args );
	}

	private function collect_sales_items_by_completed_date( $orders, $start_utc, $end_utc ) {
		// Niet meer gebruikt in v1.6.0 (we exporteren op basis van date_created), maar laten staan voor referentie
		$items = array();
		foreach ( $orders as $order ) {
			$dc = $order && $order->get_date_completed() ? $order->get_date_completed() : null; // WC_DateTime (UTC)
			if ( ! $dc ) continue;
			$ts = (int) $dc->getTimestamp();
			if ( $ts < $start_utc->getTimestamp() || $ts >= $end_utc->getTimestamp() ) continue;
			foreach ( $order->get_items( 'line_item' ) as $item ) {
				$items[] = array( $item, $order );
			}
		}
		return $items;
	}

	private function collect_sales_items_by_created_date( $orders, $start_utc, $end_utc ) {
		$items = array();
		foreach ( $orders as $order ) {
			$dc = $order && $order->get_date_created() ? $order->get_date_created() : null; // WC_DateTime (UTC)
			if ( ! $dc ) continue;
			$ts = (int) $dc->getTimestamp();
			if ( $ts < $start_utc->getTimestamp() || $ts >= $end_utc->getTimestamp() ) continue;
			foreach ( $order->get_items( 'line_item' ) as $item ) {
				$items[] = array( $item, $order );
			}
		}
		return $items;
	}

	private function collect_refund_items( $refunds, $start_utc, $end_utc ) {
		$items = array();
		foreach ( $refunds as $refund ) {
			$dt = $refund && $refund->get_date_created() ? $refund->get_date_created() : null;
			if ( ! $dt ) continue;
			$ts = (int) $dt->getTimestamp();
			if ( $ts < $start_utc->getTimestamp() || $ts >= $end_utc->getTimestamp() ) continue;
			foreach ( $refund->get_items( 'line_item' ) as $item ) {
				$items[] = array( $item, $refund );
			}
		}
		return $items;
	}

	// Fallback: orders die in de maand op wc-refunded staan, zonder refund-order in die maand
	private function collect_manual_refunded_orders( $start_utc, $end_utc ) {
		$args = array(
			'limit'         => -1,
			'paginate'      => false,
			'type'          => 'shop_order',
			'status'        => array( 'wc-refunded' ),
			'return'        => 'objects',
			'date_modified' => '>' . $start_utc->format( 'Y-m-d H:i:s' ), // string comparator
		);
		$orders = $this->get_orders_compat( $args );

		$items = array();
		foreach ( $orders as $order ) {
			$dm = $order && $order->get_date_modified() ? $order->get_date_modified() : null; // WC_DateTime (UTC)
			if ( ! $dm ) continue;
			$ts = (int) $dm->getTimestamp();
			if ( $ts < $start_utc->getTimestamp() || $ts >= $end_utc->getTimestamp() ) continue;

			// Niet dubbel tellen als er al refund-orders in de maand zijn
			$has_refund_in_month = false;
			foreach ( $order->get_refunds() as $r ) {
				$rd = $r->get_date_created();
				if ( $rd ) {
					$rts = (int) $rd->getTimestamp();
					if ( $rts >= $start_utc->getTimestamp() && $rts < $end_utc->getTimestamp() ) { $has_refund_in_month = true; break; }
				}
			}
			if ( $has_refund_in_month ) continue;

			foreach ( $order->get_items( 'line_item' ) as $item ) {
				$items[] = array( $item, $order ); // later negatief gemaakt in aggregate_items(true)
			}
		}
		return $items;
	}

	private function get_orders_compat( $args ) {
		if ( class_exists( 'WC_Order_Query' ) ) { $q = new WC_Order_Query( $args ); $orders = $q->get_orders(); if ( is_array( $orders ) ) return $orders; }
		if ( function_exists( 'wc_get_orders' ) ) return wc_get_orders( $args );
		return array();
	}

	private function aggregate_items( $pairs, $is_refund ) {
		$bucket = array();
		foreach ( $pairs as $pair ) {
			$item    = $pair[0];
			$product = $item->get_product();
			if ( ! $product ) continue;

			$product_id  = $product->get_id();
			$parent_id   = $product->is_type( 'variation' ) ? $product->get_parent_id() : $product->get_id();
			$qty_abs     = abs( (float) $item->get_quantity() );
			if ( $qty_abs <= 0 ) continue;

			$line_total_abs = abs( (float) $item->get_total() ); // excl. btw
			$unit_abs       = $qty_abs > 0 ? ( $line_total_abs / $qty_abs ) : 0.0;
			$sign           = $is_refund ? -1.0 : 1.0;

			$key = $product_id . '|' . sprintf( '%.6F', $unit_abs );
			if ( ! isset( $bucket[ $key ] ) ) {
				$fields = $this->resolve_product_fields( $product, $parent_id );
				$bucket[ $key ] = array(
					'product_id' => $product_id,
					'name'       => $fields['name'],
					'id'         => $fields['id'],
					'sku'        => $fields['sku'],
					'size'       => $fields['size'],
					'qty'        => 0.0,
					'unit_price' => $sign * $unit_abs,
					'total'      => 0.0,
				);
			}
			$bucket[ $key ]['qty']   += $sign * $qty_abs;
			$bucket[ $key ]['total'] += $sign * $line_total_abs;
		}
		usort( $bucket, function( $a, $b ){ return strcasecmp( $a['name'], $b['name'] ); } );
		return array_values( $bucket );
	}

	private function resolve_product_fields( $product, $parent_id ) {
		$sku  = $product->get_sku();
		$id   = $product->get_id();
		$size = $this->get_size_for_product( $product );
		$name = $product->get_name();
		if ( $product->is_type( 'variation' ) && $parent_id ) {
			$parent = wc_get_product( $parent_id );
			if ( $parent ) {
				$name  = $parent->get_name();
				$attrs = wc_get_formatted_variation( $product, true );
				if ( $attrs ) $name .= ' (' . wp_strip_all_tags( $attrs ) . ')';
			}
		}
		return array( 'sku' => $sku, 'id' => $id, 'size' => $size, 'name' => $name );
	}

	private function get_size_for_product( $product ) {
		if ( $product->is_type( 'variation' ) ) {
			$attrs = $product->get_attributes();
			foreach ( $this->size_attribute_keys as $key ) {
				$lookup = 'attribute_' . $key;
				if ( isset( $attrs[ $lookup ] ) && $attrs[ $lookup ] ) return (string) $attrs[ $lookup ];
				if ( isset( $attrs[ $key ] ) && $attrs[ $key ] ) return (string) $attrs[ $key ];
			}
		}
		$all = $product->get_attributes();
		foreach ( $this->size_attribute_keys as $key ) {
			if ( isset( $all[ $key ] ) ) {
				$val = $product->get_attribute( $key );
				if ( $val ) return $val;
			}
		}
		return '';
	}

	private function tsv_row( $fields ) {
		$esc = array();
		foreach ( (array) $fields as $f ) {
			$f = (string) $f;
			$f = str_replace( array("\r","\n","\t"), array(' ',' ',' '), $f );
			$esc[] = $f;
		}
		return implode("\t", $esc);
	}

	private function format_money( $amount ) {
		$neg = (float) $amount < 0;
		$abs = number_format( abs( (float) $amount ), 2, ',', '' );
		return $neg ? ( '-' . $abs ) : $abs;
	}

	private function format_qty( $qty ) {
		$qty = (float) $qty;
		if ( abs( $qty - round( $qty ) ) < 0.00001 ) return (string) (int) round( $qty );
		return number_format( $qty, 3, '.', '' );
	}
}
endif;

new WC_Monthly_Sales_Export_TSV();
