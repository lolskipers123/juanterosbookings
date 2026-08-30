;(function($){
    "use strict"

    var nav_offset_top = $('.header_area').height() + 50;

    function navbarFixed(){
        if ($('.header_area').length){
            $(window).scroll(function() {
                var scroll = $(window).scrollTop();
                if (scroll >= nav_offset_top) {
                    $(".header_area").addClass("navbar_fixed");
                } else {
                    $(".header_area").removeClass("navbar_fixed");
                }
            });
        }
    }
    navbarFixed();

    // Pretty-style the quick-guests dropdown in the hero
    if ($('#quick-guests').length) {
        $('#quick-guests').niceSelect();
    }

    // "A Peek Around Juantero's" gallery - a big centered photo, with the
    // next/previous photos peeking in dimmed on either side once there's
    // enough width for that to look intentional rather than cramped.
    // Visitors can swipe/drag or click a side photo to move between them.
    if ($('.gallery_slider').length) {
        var $gallerySlider = $('.gallery_slider');
        $gallerySlider.owlCarousel({
            items: 3,
            center: true,
            loop: true,
            nav: false,
            dots: false,
            margin: 20,
            responsive: {
                // owl-carousel's "center" mode needs an odd item count to have
                // one true middle item, so we only ever use 1 or 3 - never 2.
                // Phones and portrait tablets get one big, full-width photo;
                // landscape tablets and up get the 3-photo peek effect, since
                // splitting 3 photos across a narrow phone screen just makes
                // each one small and cramped.
                0:   { items: 1, margin: 12 },
                576: { items: 1, margin: 16 },
                768: { items: 3, margin: 18 },
                1200:{ items: 3, margin: 20 }
            }
        });

        // Clicking a dimmed side photo (not the one already centered)
        // slides the carousel over to it instead of doing nothing.
        $gallerySlider.on('click', '.owl-item:not(.center) .gallery_slide', function () {
            var $item = $(this).closest('.owl-item');
            var index = $item.index();
            $gallerySlider.trigger('to.owl.carousel', [index, 300]);
        });
    }

})(jQuery);
