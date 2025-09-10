<?php
/**
 * Plugin Name:       CPVB - F&M E-Warehousing Sales Reports
 * Description:       Genereer maandrapporten als CSV of XLSX: productregels (incl. retouren) en facturen/creditnota's. Kies bruto (incl. btw) of netto (excl. btw).
 * Plugin URI:        https://www.runiversity.nl/
 * Version:           1.10.0
 * Author:            CPVB
 * Author URI:        https://www.runiversity.nl/
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
	private $invoice_meta_keys   = array( '_wcpdf_invoice_number_formatted','_wcpdf_invoice_number','_wpo_wcpdf_invoice_number','_ywpi_document_number','_ywpi_invoice_number','_alg_wc_invoice_number','_sequential_number','_invoice_number','invoice_number','_invoice_number_display' );
	private $credit_meta_keys    = array( '_wcpdf_credit_note_number_formatted','_wcpdf_credit_note_number','_wpo_wcpdf_credit_note_number','_ywpi_credit_note_number','_ywpi_document_number','_alg_wc_credit_note_number','_credit_note_number','credit_number' );

	private $decimal_char = ','; // voor CSV-weergave

	public function __construct() {
		add_action( 'admin_menu', array( $this, 'add_admin_page' ) );
		add_action( 'admin_post_wc_mse_export_xlsx', array( $this, 'handle_export_xlsx' ) );
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

		$selected_year        = isset( $_POST['year'] ) ? (int) $_POST['year'] : (int) gmdate( 'Y' );
		$selected_month       = isset( $_POST['month'] ) ? (int) $_POST['month'] : (int) gmdate( 'n' );
		$mode                 = isset( $_POST['mode'] ) ? sanitize_key( $_POST['mode'] ) : 'products'; // products | invoices
		$selected_numfmt      = isset( $_POST['numfmt'] ) ? sanitize_key( $_POST['numfmt'] ) : 'nl';
		$selected_price_mode  = isset( $_POST['price_mode'] ) ? sanitize_key( $_POST['price_mode'] ) : 'gross'; // gross | net
		$this->decimal_char   = ( $selected_numfmt === 'en' ) ? '.' : ',';

		$csv = '';
		$filename = '';
		$just_generated = false;

		if ( isset( $_POST['do_export'] ) && isset( $_POST['_wpnonce'] ) && wp_verify_nonce( $_POST['_wpnonce'], self::NONCE ) ) {
			$year  = $selected_year;
			$month = $selected_month;
			if ( $mode === 'invoices' ) {
				$res = $this->build_csv_invoices_for_month( $year, $month );
			} else {
				$res = $this->build_csv_products_for_month( $year, $month, $selected_price_mode );
			}
			$csv   = $res['content'];
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
						<th scope="row"><?php esc_html_e( 'Exporttype', 'wc-mse' ); ?></th>
						<td>
							<label><input type="radio" name="mode" value="products" <?php checked( $mode, 'products' ); ?>> <?php esc_html_e( 'Productregels per maand (detail)', 'wc-mse' ); ?></label><br>
							<label><input type="radio" name="mode" value="invoices" <?php checked( $mode, 'invoices' ); ?>> <?php esc_html_e( 'Facturen & Creditnota\'s (samenvatting)', 'wc-mse' ); ?></label>
						</td>
					</tr>
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
					<tr>
						<th scope="row"><?php esc_html_e( 'Prijzen', 'wc-mse' ); ?></th>
						<td>
							<label><input type="radio" name="price_mode" value="gross" <?php checked( $selected_price_mode, 'gross' ); ?>> <?php esc_html_e( 'Bruto (incl. btw)', 'wc-mse' ); ?></label><br>
							<label><input type="radio" name="price_mode" value="net" <?php checked( $selected_price_mode, 'net' ); ?>> <?php esc_html_e( 'Netto (excl. btw)', 'wc-mse' ); ?></label>
						</td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Bedragnotatie (CSV)', 'wc-mse' ); ?></th>
						<td>
							<label><input type="radio" name="numfmt" value="nl" <?php checked( $selected_numfmt, 'nl' ); ?>> <?php esc_html_e( 'Komma (NL) — 1.234,56', 'wc-mse' ); ?></label><br>
							<label><input type="radio" name="numfmt" value="en" <?php checked( $selected_numfmt, 'en' ); ?>> <?php esc_html_e( 'Punt (internationaal) — 1,234.56', 'wc-mse' ); ?></label>
						</td>
					</tr>
				</table>
				<p class="submit"><button type="submit" class="button button-primary"><?php esc_html_e( 'Genereer Sales Report', 'wc-mse' ); ?></button></p>
			</form>

			<?php if ( $just_generated ) { ?>
				<h2 style="margin-top:2rem;">📄 <?php echo esc_html( sprintf( __( 'Sales Report voor %s %d', 'wc-mse' ), date_i18n( 'F', mktime(0,0,0,$selected_month,1) ), $selected_year ) ); ?></h2>
				<p><?php esc_html_e( 'Kopieer de inhoud of download als bestand. CSV opent netjes in Excel/Sheets. XLSX bevat echte numerieke cellen.', 'wc-mse' ); ?></p>
				<input type="hidden" id="mse-filename" value="<?php echo esc_attr( $filename ); ?>" />
				<p>
					<button id="mse-download" class="button button-primary">⬇ <?php esc_html_e( 'Download .csv', 'wc-mse' ); ?></button>
					<a id="mse-download-xlsx" class="button button-secondary" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=wc_mse_export_xlsx&mode=' . $mode . '&year=' . $selected_year . '&month=' . $selected_month . '&numfmt=' . $selected_numfmt . '&price_mode=' . $selected_price_mode ), self::NONCE ) ); ?>">⬇ <?php esc_html_e( 'Download .xlsx', 'wc-mse' ); ?></a>
					<button id="mse-copy" class="button">📋 <?php esc_html_e( 'Kopieer', 'wc-mse' ); ?></button>
				</p>
				<textarea id="mse-tsv" rows="20" style="width:100%;font-family:Menlo,Consolas,monospace;white-space:pre;"><?php echo esc_textarea( $csv ); ?></textarea>
				<script>
				(function(){
				  var d=document, a=function(id){return d.getElementById(id)};
				  var btn=a('mse-download'), copy=a('mse-copy'), area=a('mse-tsv'), name=a('mse-filename');
				  if(btn){btn.addEventListener('click',function(e){e.preventDefault();
				    var blob=new Blob([area.value],{type:'text/csv;charset=utf-8'});
				    var link=d.createElement('a'); link.href=URL.createObjectURL(blob);
				    link.download=name && name.value ? name.value : 'export.csv';
				    d.body.appendChild(link); link.click(); setTimeout(function(){URL.revokeObjectURL(link.href);link.remove();},1500);
				  });}
				  if(copy){copy.addEventListener('click',function(e){e.preventDefault(); area.focus(); area.select(); try{document.execCommand('copy'); copy.textContent='✔ Gekopieerd'; setTimeout(function(){copy.textContent='📋 Kopieer';},1200);}catch(err){}});}
				})();
				</script>
			<?php } ?>

			<p style="margin-top:2rem;"><em><?php esc_html_e( 'Product-export kolommen: Productnaam, ID, SKU, Size, Aantal verkocht, Prijs/stuk, Prijs totaal (netto of bruto naar keuze). Retouren staan apart met negatieve aantallen/bedragen. Onderaan: Totaal omzet (netto of bruto).', 'wc-mse' ); ?></em></p>
		</div>
		<?php
	}

	// ===== CSV: PRODUCTREGELS =====
	private function build_csv_products_for_month( $year, $month, $price_mode = 'gross' ) {
		list( $start_site, $end_site ) = $this->get_month_bounds_in_site_tz( $year, $month );
		$start_utc = clone $start_site; $start_utc->setTimezone( new \DateTimeZone( 'UTC' ) );
		$end_utc   = clone $end_site;   $end_utc->setTimezone( new \DateTimeZone( 'UTC' ) );

		$sales_orders  = $this->query_orders_after( 'shop_order', array( 'wc-completed', 'wc-refunded' ), $start_utc );
		$sales_items   = $this->collect_sales_items_by_created_date( $sales_orders, $start_utc, $end_utc );

		$refund_orders = $this->query_orders_after( 'shop_order_refund', null, $start_utc );
		$refund_items  = $this->collect_refund_items( $refund_orders, $start_utc, $end_utc );
		$manual_refund_items = $this->collect_manual_refunded_orders( $start_utc, $end_utc );

		$use_gross   = ( $price_mode === 'gross' );
		$agg_sales   = $this->aggregate_items( $sales_items, false, $use_gross );
		$agg_refunds = $this->aggregate_items( array_merge( $refund_items, $manual_refund_items ), true, $use_gross );

		// Debug order-id's
		$sales_ids  = array(); $credit_ids = array();
		foreach ( $sales_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $sales_ids[ $oid ] = true; } }
		foreach ( $refund_items as $p ) { $o = $p[1]; $oid = 0; if ( $o && method_exists( $o, 'get_parent_id' ) ) { $oid = (int) $o->get_parent_id(); } if ( ! $oid && $o && method_exists( $o, 'get_id' ) ) { $oid = (int) $o->get_id(); } if ( $oid ) { $credit_ids[ $oid ] = true; } }
		foreach ( $manual_refund_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $credit_ids[ $oid ] = true; } }
		$si = array_keys( $sales_ids ); sort( $si, SORT_NUMERIC );
		$ci = array_keys( $credit_ids ); sort( $ci, SORT_NUMERIC );
		$sales_ids_str  = implode( ', ', $si );
		$credit_ids_str = implode( ', ', $ci );

		$lines = array();
		$col_unit  = $use_gross ? 'Prijs/stuk incl. btw' : 'Prijs/stuk excl. btw';
		$col_total = $use_gross ? 'Prijs totaal incl. btw' : 'Prijs totaal excl. btw';
		$lines[] = $this->csv_row( array( 'Productnaam', 'ID', 'SKU', 'Size', 'Aantal verkocht', $col_unit, $col_total ) );

		$net_total = 0.0;
		foreach ( $agg_sales as $row ) {
			$net_total += (float) $row['total'];
			$lines[] = $this->csv_row( array( $row['name'], $row['id'], $row['sku'], $row['size'], $this->format_qty( $row['qty'] ), $this->format_money( $row['unit_price'] ), $this->format_money( $row['total'] ) ) );
		}

		if ( ! empty( $agg_refunds ) ) {
			$lines[] = '';
			$lines[] = '# RETOUREN (negatieve aantallen en bedragen)';
			foreach ( $agg_refunds as $row ) {
				$net_total += (float) $row['total'];
				$lines[] = $this->csv_row( array( $row['name'], $row['id'], $row['sku'], $row['size'], $this->format_qty( $row['qty'] ), $this->format_money( $row['unit_price'] ), $this->format_money( $row['total'] ) ) );
			}
		}

		$lines[] = '';
		$footer_label = $use_gross ? 'Totaal omzet incl. btw' : 'Totaal omzet excl. btw';
		$lines[] = $this->csv_row( array( $footer_label, '', '', '', '', '', $this->format_money( $net_total ) ) );

		$lines[] = '';
		$lines[] = 'Debiteuren: ' . $sales_ids_str;
		$lines[] = 'Crediteuren: ' . $credit_ids_str;

		$content  = implode( "\n", $lines ) . "\n";
		$filename = sprintf( 'wc-export-%04d-%02d.csv', $year, $month );
		return array( 'content' => $content, 'filename' => $filename );
	}

	// ===== CSV: FACTUREN & CREDITNOTA'S =====
	private function build_csv_invoices_for_month( $year, $month ) {
		list( $start_site, $end_site ) = $this->get_month_bounds_in_site_tz( $year, $month );
		$start_utc = clone $start_site; $start_utc->setTimezone( new \DateTimeZone( 'UTC' ) );
		$end_utc   = clone $end_site;   $end_utc->setTimezone( new \DateTimeZone( 'UTC' ) );

		$orders  = $this->filter_orders_by_created_between( $this->query_orders_after( 'shop_order', array( 'wc-completed', 'wc-refunded' ), $start_utc ), $start_utc, $end_utc );
		$refunds = $this->filter_orders_by_created_between( $this->query_orders_after( 'shop_order_refund', null, $start_utc ), $start_utc, $end_utc );

		$lines = array();
		$lines[] = $this->csv_row( array( 'Factuurnummer', 'Naam', 'Besteldatum', 'Bruto bedrag' ) );
		foreach ( $orders as $order ) {
			$lines[] = $this->csv_row( array(
				$this->get_invoice_number_for_order( $order ),
				$this->get_order_name( $order ),
				$this->format_date_site( $order->get_date_created() ),
				$this->format_money( (float) $order->get_total() )
			) );
		}
		if ( ! empty( $refunds ) ) {
			$lines[] = '';
			$lines[] = '# CREDITNOTA\'s (retouren)';
			$lines[] = $this->csv_row( array( 'Cred. nummer', 'Naam', 'Besteldatum', 'Bruto bedrag' ) );
			foreach ( $refunds as $refund ) {
				$parent = $refund->get_parent_id() ? wc_get_order( $refund->get_parent_id() ) : null;
				$lines[] = $this->csv_row( array(
					$this->get_credit_number_for_refund( $refund ),
					$parent ? $this->get_order_name( $parent ) : '',
					$this->format_date_site( $refund->get_date_created() ),
					$this->format_money( (float) $refund->get_total() )
				) );
			}
		}

		$content  = implode( "\n", $lines ) . "\n";
		$filename = sprintf( 'wc-invoices-%04d-%02d.csv', $year, $month );
		return array( 'content' => $content, 'filename' => $filename );
	}

	// ===== Helpers =====
	private function filter_orders_by_created_between( $orders, $start_utc, $end_utc ) {
		$out = array();
		foreach ( $orders as $o ) {
			$dc = $o && $o->get_date_created() ? $o->get_date_created() : null;
			if ( ! $dc ) continue;
			$ts = (int) $dc->getTimestamp();
			if ( $ts >= $start_utc->getTimestamp() && $ts < $end_utc->getTimestamp() ) $out[] = $o;
		}
		return $out;
	}

	private function get_invoice_number_for_order( $order ) {
		foreach ( $this->invoice_meta_keys as $k ) {
			$val = $order->get_meta( $k );
			if ( $val !== '' && $val !== null ) return (string) $val;
		}
		return (string) $order->get_order_number();
	}

	private function get_credit_number_for_refund( $refund ) {
		foreach ( $this->credit_meta_keys as $k ) {
			$val = $refund->get_meta( $k );
			if ( $val !== '' && $val !== null ) return (string) $val;
		}
		$id = method_exists( $refund, 'get_id' ) ? (int) $refund->get_id() : 0;
		return $id ? ( 'CR-' . $id ) : '';
	}

	private function get_order_name( $order ) {
		$company = $order->get_billing_company();
		$first   = $order->get_billing_first_name();
		$last    = $order->get_billing_last_name();
		$name    = trim( $first . ' ' . $last );
		if ( $company ) return $company . ( $name ? ' - ' . $name : '' );
		return $name;
	}

	private function format_date_site( $wc_datetime ) {
		if ( ! $wc_datetime ) return '';
		$tz = $this->get_site_timezone();
		$dt = clone $wc_datetime; // WC_DateTime
		$dt->setTimezone( $tz );
		return $dt->format( 'Y-m-d' );
	}

	private function get_month_bounds_in_site_tz( $year, $month ) {
		$tz = $this->get_site_timezone();
		$start = new \DateTime( sprintf( '%04d-%02d-01 00:00:00', $year, $month ), $tz );
		$end   = clone $start; $end->modify( 'first day of next month 00:00:00' );
		return array( $start, $end );
	}

	private function get_site_timezone() {
		if ( function_exists( 'wp_timezone' ) ) return wp_timezone();
		$tz_string = get_option( 'timezone_string' );
		if ( $tz_string ) { try { return new \DateTimeZone( $tz_string ); } catch ( \Exception $e ) {} }
		return new \DateTimeZone( 'UTC' );
	}

	private function query_orders_after( $type, $statuses, $start_utc ) {
		$args = array(
			'limit'        => -1,
			'paginate'     => false,
			'type'         => $type,
			'return'       => 'objects',
			'currency'     => '',
			'date_created' => '>' . $start_utc->format( 'Y-m-d H:i:s' ),
		);
		if ( $statuses ) $args['status'] = $statuses;
		return $this->get_orders_compat( $args );
	}

	private function get_orders_compat( $args ) {
		if ( class_exists( 'WC_Order_Query' ) ) { $q = new \WC_Order_Query( $args ); $orders = $q->get_orders(); if ( is_array( $orders ) ) return $orders; }
		if ( function_exists( 'wc_get_orders' ) ) return wc_get_orders( $args );
		return array();
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

	private function collect_manual_refunded_orders( $start_utc, $end_utc ) {
		$args = array(
			'limit'         => -1,
			'paginate'      => false,
			'type'          => 'shop_order',
			'status'        => array( 'wc-refunded' ),
			'return'        => 'objects',
			'date_modified' => '>' . $start_utc->format( 'Y-m-d H:i:s' ),
		);
		$orders = $this->get_orders_compat( $args );

		$items = array();
		foreach ( $orders as $order ) {
			$dm = $order && $order->get_date_modified() ? $order->get_date_modified() : null; // WC_DateTime (UTC)
			if ( ! $dm ) continue;
			$ts = (int) $dm->getTimestamp();
			if ( $ts < $start_utc->getTimestamp() || $ts >= $end_utc->getTimestamp() ) continue;

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
				$items[] = array( $item, $order );
			}
		}
		return $items;
	}

	private function aggregate_items( $pairs, $is_refund, $use_gross = true ) {
		$bucket = array();
		foreach ( $pairs as $pair ) {
			$item    = $pair[0];
			$product = $item->get_product();
			if ( ! $product ) continue;

			$product_id  = $product->get_id();
			$parent_id   = $product->is_type( 'variation' ) ? $product->get_parent_id() : $product->get_id();
			$qty_abs     = abs( (float) $item->get_quantity() );
			if ( $qty_abs <= 0 ) continue;

			$line_total_abs_net  = abs( (float) $item->get_total() );
			$line_total_tax_abs  = abs( (float) $item->get_total_tax() );
			$line_total_abs      = $use_gross ? ( $line_total_abs_net + $line_total_tax_abs ) : $line_total_abs_net;
			$unit_abs            = $qty_abs > 0 ? ( $line_total_abs / $qty_abs ) : 0.0;
			$sign                = $is_refund ? -1.0 : 1.0;

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

	private function csv_row( $fields ) {
		$del = ';';
		$out = array();
		foreach ( (array) $fields as $f ) {
			$f = (string) $f;
			$f = str_replace('"', '""', $f); // verdubbel quotes
			$out[] = '"' . $f . '"';
		}
		return implode( $del, $out );
	}

	private function format_money( $amount ) {
		$neg = (float) $amount < 0;
		$dec = ( $this->decimal_char === '.' ) ? '.' : ',';
		$abs = number_format( abs( (float) $amount ), 2, $dec, '' );
		return $neg ? ( '-' . $abs ) : $abs;
	}

	private function format_qty( $qty ) {
		$qty = (float) $qty;
		if ( abs( $qty - round( $qty ) ) < 0.00001 ) return (string) (int) round( $qty );
		return number_format( $qty, 3, '.', '' );
	}

	// ===== XLSX =====
	public function handle_export_xlsx() {
		if ( ! current_user_can( 'manage_woocommerce' ) ) { wp_die( 'Geen rechten.' ); }
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( $_GET['_wpnonce'], self::NONCE ) ) { wp_die( 'Ongeldige nonce.' ); }
		$year  = isset( $_GET['year'] ) ? (int) $_GET['year'] : (int) gmdate( 'Y' );
		$month = isset( $_GET['month'] ) ? (int) $_GET['month'] : (int) gmdate( 'n' );
		$mode  = isset( $_GET['mode'] ) ? sanitize_key( $_GET['mode'] ) : 'products';
		$price_mode = isset( $_GET['price_mode'] ) ? sanitize_key( $_GET['price_mode'] ) : 'gross';

		if ( ! class_exists( '\\Shuchkin\\SimpleXLSXGen' ) ) {
			$lib = __DIR__ . '/SimpleXLSXGen.php';
			if ( file_exists( $lib ) ) { require_once $lib; } else { wp_die( 'SimpleXLSXGen.php niet gevonden.' ); }
		}

		if ( $mode === 'invoices' ) {
			list( $rows, $filename ) = $this->build_xlsx_invoices_for_month( $year, $month );
		} else {
			list( $rows, $filename ) = $this->build_xlsx_products_for_month( $year, $month, $price_mode );
		}

		$xlsx = \Shuchkin\SimpleXLSXGen::fromArray( $rows );
		if ( function_exists( 'nocache_headers' ) ) { nocache_headers(); }
		$xlsx->downloadAs( $filename );
		exit;
	}

	private function build_xlsx_products_for_month( $year, $month, $price_mode = 'gross' ) {
		list( $start_site, $end_site ) = $this->get_month_bounds_in_site_tz( $year, $month );
		$start_utc = clone $start_site; $start_utc->setTimezone( new \DateTimeZone( 'UTC' ) );
		$end_utc   = clone $end_site;   $end_utc->setTimezone( new \DateTimeZone( 'UTC' ) );

		$sales_orders  = $this->query_orders_after( 'shop_order', array( 'wc-completed', 'wc-refunded' ), $start_utc );
		$sales_items   = $this->collect_sales_items_by_created_date( $sales_orders, $start_utc, $end_utc );

		$refund_orders = $this->query_orders_after( 'shop_order_refund', null, $start_utc );
		$refund_items  = $this->collect_refund_items( $refund_orders, $start_utc, $end_utc );
		$manual_refund_items = $this->collect_manual_refunded_orders( $start_utc, $end_utc );

		$use_gross   = ( $price_mode === 'gross' );
		$agg_sales   = $this->aggregate_items( $sales_items, false, $use_gross );
		$agg_refunds = $this->aggregate_items( array_merge( $refund_items, $manual_refund_items ), true, $use_gross );

		$rows = array();
		$rows[] = array( 'Productnaam', 'ID', 'SKU', 'Size', 'Aantal verkocht', $use_gross ? 'Prijs/stuk incl. btw' : 'Prijs/stuk excl. btw', $use_gross ? 'Prijs totaal incl. btw' : 'Prijs totaal excl. btw' );

		$net_total = 0.0;
		foreach ( $agg_sales as $r ) {
			$net_total += (float) $r['total'];
			$rows[] = array( $r['name'], (int) $r['id'], (string) $r['sku'], (string) $r['size'], (float) $r['qty'], round( (float) $r['unit_price'], 2 ), round( (float) $r['total'], 2 ) );
		}
		if ( ! empty( $agg_refunds ) ) {
			$rows[] = array();
			$rows[] = array( '# RETOUREN (negatieve aantallen en bedragen)' );
			foreach ( $agg_refunds as $r ) {
				$net_total += (float) $r['total'];
				$rows[] = array( $r['name'], (int) $r['id'], (string) $r['sku'], (string) $r['size'], (float) $r['qty'], round( (float) $r['unit_price'], 2 ), round( (float) $r['total'], 2 ) );
			}
		}
		$rows[] = array();
		$rows[] = array( $use_gross ? 'Totaal omzet incl. btw' : 'Totaal omzet excl. btw', '', '', '', '', '', round( (float) $net_total, 2 ) );

		// Debug
		$sales_ids  = array(); $credit_ids = array();
		foreach ( $sales_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $sales_ids[ $oid ] = true; } }
		foreach ( $refund_items as $p ) { $o = $p[1]; $oid = 0; if ( $o && method_exists( $o, 'get_parent_id' ) ) { $oid = (int) $o->get_parent_id(); } if ( ! $oid && $o && method_exists( $o, 'get_id' ) ) { $oid = (int) $o->get_id(); } if ( $oid ) { $credit_ids[ $oid ] = true; } }
		foreach ( $manual_refund_items as $p ) { $oid = $p[1] ? (int) $p[1]->get_id() : 0; if ( $oid ) { $credit_ids[ $oid ] = true; } }
		$si = array_keys( $sales_ids ); sort( $si, SORT_NUMERIC );
		$ci = array_keys( $credit_ids ); sort( $ci, SORT_NUMERIC );
		$rows[] = array();
		$rows[] = array( 'Debiteuren: ' . implode( ', ', $si ) );
		$rows[] = array( 'Crediteuren: ' . implode( ', ', $ci ) );

		$filename = sprintf( 'wc-export-%04d-%02d.xlsx', $year, $month );
		return array( $rows, $filename );
	}

	private function build_xlsx_invoices_for_month( $year, $month ) {
		list( $start_site, $end_site ) = $this->get_month_bounds_in_site_tz( $year, $month );
		$start_utc = clone $start_site; $start_utc->setTimezone( new \DateTimeZone( 'UTC' ) );
		$end_utc   = clone $end_site;   $end_utc->setTimezone( new \DateTimeZone( 'UTC' ) );

		$orders  = $this->filter_orders_by_created_between( $this->query_orders_after( 'shop_order', array( 'wc-completed', 'wc-refunded' ), $start_utc ), $start_utc, $end_utc );
		$refunds = $this->filter_orders_by_created_between( $this->query_orders_after( 'shop_order_refund', null, $start_utc ), $start_utc, $end_utc );

		$rows = array();
		$rows[] = array( 'Factuurnummer', 'Naam', 'Besteldatum', 'Bruto bedrag' );
		foreach ( $orders as $order ) {
			$rows[] = array(
				$this->get_invoice_number_for_order( $order ),
				$this->get_order_name( $order ),
				$this->format_date_site( $order->get_date_created() ),
				round( (float) $order->get_total(), 2 )
			);
		}
		if ( ! empty( $refunds ) ) {
			$rows[] = array();
			$rows[] = array( '# CREDITNOTA\'s (retouren)' );
			$rows[] = array( 'Cred. nummer', 'Naam', 'Besteldatum', 'Bruto bedrag' );
			foreach ( $refunds as $refund ) {
				$parent = $refund->get_parent_id() ? wc_get_order( $refund->get_parent_id() ) : null;
				$rows[] = array(
					$this->get_credit_number_for_refund( $refund ),
					$parent ? $this->get_order_name( $parent ) : '',
					$this->format_date_site( $refund->get_date_created() ),
					round( (float) $refund->get_total(), 2 )
				);
			}
		}

		$filename = sprintf( 'wc-invoices-%04d-%02d.xlsx', $year, $month );
		return array( $rows, $filename );
	}
}
endif;

new WC_Monthly_Sales_Export_TSV();
